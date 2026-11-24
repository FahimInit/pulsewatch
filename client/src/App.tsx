import { Routes, Route, Navigate } from 'react-router-dom';

export function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <div className="min-h-screen flex items-center justify-center bg-pw-bg text-pw-text">
            <div className="rounded-pw border border-pw-border bg-white p-8 text-center shadow-xs">
              <div className="mx-auto mb-3 grid h-9 w-9 place-items-center rounded-[9px] bg-pw-primary font-extrabold text-white">
                P
              </div>
              <h1 className="text-lg font-bold">Pulsewatch</h1>
              <p className="mt-1 text-xs text-pw-muted">
                Foundation ready — initializing workspace modules
              </p>
            </div>
          </div>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
