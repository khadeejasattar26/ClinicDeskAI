import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdminDashboard } from './AdminDashboard';
import { AdminLogin } from './AdminLogin';
const auth = { token:'staff-token' as string | null, ready:true, signIn:vi.fn(), signOut:vi.fn(), demoLogin:vi.fn() };
vi.mock('./auth', () => ({ useAuth: () => auth }));
beforeEach(() => { auth.token='staff-token'; vi.stubGlobal('fetch',vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
function renderDashboard() { return render(<MemoryRouter initialEntries={['/admin']}><Routes><Route path="/admin" element={<AdminDashboard/>}/><Route path="/admin/login" element={<p>Sign in required</p>}/></Routes></MemoryRouter>); }
test('anonymous dashboard requests redirect to login', async () => { auth.token=null; renderDashboard(); expect(await screen.findByText('Sign in required')).toBeVisible(); expect(fetch).not.toHaveBeenCalled(); });
test('dashboard shows appointments then usage with an accessible chart', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({items:[{id:'a',patient_name:'Demo Patient',patient_email:'demo@example.com',patient_phone:'03001234567',reason:'General',status:'confirmed',starts_at:'2026-11-10T04:00:00Z'}],hasMore:false})} as Response);
  renderDashboard(); const user=userEvent.setup();
  expect(await screen.findByText('Demo Patient')).toBeVisible();
  expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({Authorization:'Bearer staff-token'});
  vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({total_tokens:120,total_cost_usd:0,total_calls:3,average_latency_ms:14,mock:true,cost_configured:true,daily:[{day:'2026-11-02',requests:3}]})} as Response);
  await user.click(screen.getByRole('button',{name:'Usage'}));
  expect(await screen.findByText('120')).toBeVisible();
  expect(screen.getByRole('img',{name:/Model calls per day/})).toBeVisible();
  expect(screen.getByText('Mock AI calls have no provider cost')).toBeVisible();
});
test('staff can view a conversation transcript and errors are visible', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({items:[],hasMore:false})} as Response);
  renderDashboard(); const user=userEvent.setup();
  await screen.findByText('Room for the next hello.');
  vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({items:[{id:'conversation-1',created_at:'2026-11-02T04:00:00Z',status:'follow_up',handoff_reason:'Patient requested staff'}],hasMore:false})} as Response);
  await user.click(screen.getByRole('button',{name:'Conversations'}));
  await screen.findByText('Patient requested staff');
  vi.mocked(fetch).mockResolvedValueOnce({ok:true,json:async()=>({conversation:{id:'conversation-1'},messages:[{id:'m',role:'user',content:'Please call me back',created_at:'2026-11-02T04:00:00Z'}],hasMore:false})} as Response);
  await user.click(screen.getByRole('button',{name:/View transcript/}));
  expect(await screen.findByText('Please call me back')).toBeVisible();
  vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
  await user.click(screen.getByRole('button',{name:'Leads'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to reach reception');
});
test('login submits Supabase credentials and shows a safe error', async () => {
  auth.token=null; auth.signIn.mockRejectedValueOnce(new Error('Sign-in failed.'));
  render(<MemoryRouter><AdminLogin/></MemoryRouter>); const user=userEvent.setup();
  await user.type(screen.getByLabelText('Email address'),'staff@example.com');
  await user.type(screen.getByLabelText('Password'),'wrong-password');
  await user.click(screen.getByRole('button',{name:'Sign in to your clinic'}));
  expect(auth.signIn).toHaveBeenCalledWith('staff@example.com','wrong-password');
  await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Sign-in failed.'));
});
