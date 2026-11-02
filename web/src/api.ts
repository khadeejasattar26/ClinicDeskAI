export const API_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
export const CLINIC_ID = import.meta.env.VITE_CLINIC_ID ?? '11111111-1111-4111-8111-111111111111';
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150_000);
  try {
    const response = await fetch(`${API_URL}${path}`, { ...options, signal: options.signal ?? controller.signal, headers: { 'Content-Type': 'application/json', ...options.headers } });
    const data = await response.json();
    if (!response.ok) throw new ApiError(response.status, data.error?.message ?? 'Request failed. Please try again.');
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, 'Unable to reach reception. Check your connection and try again.');
  } finally { clearTimeout(timeout); }
}
export function formatTime(iso: string) { return new Intl.DateTimeFormat('en-PK', { timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)); }
