import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { registerSchema, loginSchema, type RegisterInput, type LoginInput } from '@pulsewatch/shared';
import { Activity, AlertCircle, ArrowRight, ShieldCheck, KeyRound } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/api/client';
import { useAuthStore, type AuthUser } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const setSession = useAuthStore((s) => s.setSession);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const fillDemoCredentials = () => {
    setServerError(null);
    setValue('email', 'john@example.com', { shouldValidate: true });
    setValue('password', 'Password123', { shouldValidate: true });
  };

  const onSubmit = async (values: LoginInput) => {
    setServerError(null);
    try {
      const data = await apiFetch<{ user: AuthUser; accessToken: string }>('/auth/login', {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify(values),
      });
      setSession(data.user, data.accessToken);
      const redirectTo = (location.state as { from?: string })?.from || '/';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setServerError(err instanceof ApiClientError ? err.message : 'Unable to sign in');
    }
  };

  return (
    <div className="min-h-screen bg-pw-bg flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex items-center justify-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-[9px] bg-pw-primary text-[18px] font-extrabold text-white">
            P
          </div>
          <span className="text-[22px] font-extrabold tracking-[-0.8px] text-pw-text">
            pulsewatch
          </span>
        </div>
        <h1 className="mt-6 text-center text-[22px] font-bold tracking-tight text-pw-text">
          Sign in to your workspace
        </h1>
        <p className="mt-1.5 text-center text-[12px] text-pw-muted">
          Monitor uptime, response times, and active incidents in real time.
        </p>
      </div>

      <div className="mt-7 sm:mx-auto sm:w-full sm:max-w-[420px]">
        <div className="rounded-pw border border-pw-border bg-white p-7 shadow-xs">
          <div className="mb-5 rounded-[10px] border border-[#ebe4ff] bg-[#f5f2ff] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-pw-primary">
                <KeyRound className="h-3.5 w-3.5" />
                Demo Account
              </span>
              <button
                type="button"
                onClick={fillDemoCredentials}
                className="rounded-[6px] bg-white px-2.5 py-1 text-[10.5px] font-semibold text-pw-primary border border-[#ebe4ff] hover:bg-pw-primary hover:text-white transition-colors"
              >
                Auto-fill demo
              </button>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-[#676a80]">
              <div>
                Email: <code className="font-mono font-semibold text-pw-text">john@example.com</code>
              </div>
              <div>
                Password: <code className="font-mono font-semibold text-pw-text">Password123</code>
              </div>
            </div>
          </div>

          {serverError && (
            <div className="mb-4 flex items-start gap-2 rounded-[8px] border border-pw-red/25 bg-pw-red-bg px-3 py-2.5 text-[11.5px] text-pw-red">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{serverError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="john@example.com"
                {...register('email')}
              />
              {errors.email && (
                <p className="mt-1 text-[10.5px] text-pw-red">{errors.email.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                {...register('password')}
              />
              {errors.password && (
                <p className="mt-1 text-[10.5px] text-pw-red">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full py-2.5" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Sign in'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </form>

          <div className="mt-6 border-t border-pw-border pt-4 text-center text-[11.5px] text-pw-muted">
            New to Pulsewatch?{' '}
            <Link to="/register" className="font-semibold text-pw-primary hover:underline">
              Create developer account →
            </Link>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-center gap-4 text-[10.5px] text-pw-muted">
          <span className="inline-flex items-center gap-1">
            <Activity className="h-3.5 w-3.5 text-pw-green" /> Real-time checks
          </span>
          <span>·</span>
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="h-3.5 w-3.5 text-pw-primary" /> SSRF-hardened engine
          </span>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const setActiveProjectId = useAuthStore((s) => s.setActiveProjectId);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const onSubmit = async (values: RegisterInput) => {
    setServerError(null);
    try {
      const data = await apiFetch<{
        user: AuthUser;
        defaultProjectId: string;
        accessToken: string;
      }>('/auth/register', {
        method: 'POST',
        skipAuth: true,
        body: JSON.stringify(values),
      });
      setActiveProjectId(data.defaultProjectId);
      setSession(data.user, data.accessToken);
      navigate('/', { replace: true });
    } catch (err) {
      setServerError(err instanceof ApiClientError ? err.message : 'Unable to register');
    }
  };

  return (
    <div className="min-h-screen bg-pw-bg flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex items-center justify-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-[9px] bg-pw-primary text-[18px] font-extrabold text-white">
            P
          </div>
          <span className="text-[22px] font-extrabold tracking-[-0.8px] text-pw-text">
            pulsewatch
          </span>
        </div>
        <h1 className="mt-6 text-center text-[22px] font-bold tracking-tight text-pw-text">
          Create your monitoring workspace
        </h1>
        <p className="mt-1.5 text-center text-[12px] text-pw-muted">
          Includes 20 active HTTP/HTTPS monitors, incident automation, and status pages.
        </p>
      </div>

      <div className="mt-7 sm:mx-auto sm:w-full sm:max-w-[420px]">
        <div className="rounded-pw border border-pw-border bg-white p-7 shadow-xs">
          <div className="mb-5 rounded-[10px] border border-[#ebe4ff] bg-[#f5f2ff] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-pw-primary">
                <KeyRound className="h-3.5 w-3.5" />
                Demo Account
              </span>
              <button
                type="button"
                onClick={fillDemoCredentials}
                className="rounded-[6px] bg-white px-2.5 py-1 text-[10.5px] font-semibold text-pw-primary border border-[#ebe4ff] hover:bg-pw-primary hover:text-white transition-colors"
              >
                Auto-fill demo
              </button>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-[#676a80]">
              <div>
                Email: <code className="font-mono font-semibold text-pw-text">john@example.com</code>
              </div>
              <div>
                Password: <code className="font-mono font-semibold text-pw-text">Password123</code>
              </div>
            </div>
          </div>

          {serverError && (
            <div className="mb-4 flex items-start gap-2 rounded-[8px] border border-pw-red/25 bg-pw-red-bg px-3 py-2.5 text-[11.5px] text-pw-red">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{serverError}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="name">Full name</Label>
              <Input
                id="name"
                placeholder="John Developer"
                autoComplete="name"
                {...register('name')}
              />
              {errors.name && (
                <p className="mt-1 text-[10.5px] text-pw-red">{errors.name.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="email">Work email</Label>
              <Input
                id="email"
                type="email"
                placeholder="john@example.com"
                autoComplete="email"
                {...register('email')}
              />
              {errors.email && (
                <p className="mt-1 text-[10.5px] text-pw-red">{errors.email.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 8 chars, upper, lower & number"
                autoComplete="new-password"
                {...register('password')}
              />
              {errors.password && (
                <p className="mt-1 text-[10.5px] text-pw-red">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full py-2.5" disabled={isSubmitting}>
              {isSubmitting ? 'Creating workspace...' : 'Create account'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </form>

          <div className="mt-6 border-t border-pw-border pt-4 text-center text-[11.5px] text-pw-muted">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-pw-primary hover:underline">
              Sign in →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
