import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';

export function useRealtimeSync(activeProjectId?: string | null): void {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((s) => s.accessToken);
  const setSocketConnected = useAuthStore((s) => s.setSocketConnected);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!accessToken) {
      setSocketConnected(false);
      return;
    }

    const socketUrl = import.meta.env.VITE_SOCKET_URL || window.location.origin;
    const socket = io(socketUrl, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      if (activeProjectId) {
        socket.emit('join:project', activeProjectId);
      }
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('monitor:checked', (evt: { projectId: string; monitorId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['monitors', evt.projectId] });
      queryClient.invalidateQueries({ queryKey: ['monitor', evt.projectId, evt.monitorId] });
      queryClient.invalidateQueries({
        queryKey: ['monitor-results', evt.projectId, evt.monitorId],
      });
      queryClient.invalidateQueries({ queryKey: ['analytics-overview', evt.projectId] });
      queryClient.invalidateQueries({ queryKey: ['analytics-latency', evt.projectId] });
    });

    socket.on('monitor:status_changed', (evt: { projectId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['monitors', evt.projectId] });
      queryClient.invalidateQueries({ queryKey: ['analytics-health', evt.projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    });

    const onIncidentEvent = (evt: { projectId: string; incidentId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['incidents', evt.projectId] });
      queryClient.invalidateQueries({ queryKey: ['incident', evt.projectId, evt.incidentId] });
      queryClient.invalidateQueries({ queryKey: ['analytics-overview', evt.projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    };

    socket.on('incident:created', onIncidentEvent);
    socket.on('incident:updated', onIncidentEvent);
    socket.on('incident:resolved', onIncidentEvent);

    socket.on('notification:new', () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    };
  }, [accessToken, queryClient, setSocketConnected]);

  useEffect(() => {
    const socket = socketRef.current;
    if (socket && socket.connected && activeProjectId) {
      socket.emit('join:project', activeProjectId);
    }
  }, [activeProjectId]);
}
