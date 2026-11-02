import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, CLINIC_ID, DEMO_MODE, formatTime } from './api';
import { Icon } from './Icon';
import styles from './ChatWidget.module.css';
interface Slot { id: string; starts_at: string }
interface Booking { slot_id: string; patient_name: string; patient_email: string; patient_phone: string; reason: string; starts_at: string }
type Action = { type: 'slots'; data: Slot[] } | { type: 'confirm_booking'; data: Booking } | { type: 'booked'; data: { id: string; starts_at: string; email_status: string } } | { type: 'knowledge' | 'lead' | 'handoff'; data: unknown };
interface ChatResponse { conversationId: string; reply: string; actions: Action[] }
interface Message { role: 'user' | 'assistant'; content: string; actions?: Action[] }
const greeting: Message = { role: 'assistant', content: 'Hello, welcome to CareWell 🌿 I can help with clinic questions, appointments, or getting in touch with reception. How can I help you today?' };
const sessionKey = `clinicdesk:${CLINIC_ID}`;
export function ChatWidget({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([greeting]);
  const [conversationId, setConversationId] = useState<string | undefined>(() => { try { return sessionStorage.getItem(sessionKey) ?? undefined; } catch { return undefined; } });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [showLead, setShowLead] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const sending = useRef(false);
  useEffect(() => { if (open) inputRef.current?.focus(); else launcherRef.current?.focus(); }, [open]);
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [messages, busy, selectedSlot, showLead]);
  function storeSession(id?: string) { setConversationId(id); try { if (id) sessionStorage.setItem(sessionKey, id); else sessionStorage.removeItem(sessionKey); } catch { /* Private browsing can disable storage. */ } }
  async function send(text: string, label?: string) {
    if (!text.trim() || sending.current) return;
    sending.current = true; setBusy(true); setError(''); setInput('');
    setMessages(old => [...old, { role: 'user', content: label ?? text }]);
    try {
      const result = await api<ChatResponse>('/api/chat', { method: 'POST', body: JSON.stringify({ clinicId: CLINIC_ID, conversationId, message: text }) });
      storeSession(result.conversationId);
      setMessages(old => [...old, { role: 'assistant', content: result.reply, actions: result.actions }]);
      setSelectedSlot(null); setShowLead(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) { storeSession(); setError('This chat has expired. Start a new chat to continue.'); }
      else setError(err instanceof Error ? err.message : 'Please try again.');
    } finally { sending.current = false; setBusy(false); inputRef.current?.focus(); }
  }
  function reset() { if (busy) return; storeSession(); setMessages([greeting]); setError(''); setSelectedSlot(null); setShowLead(false); setInput(''); inputRef.current?.focus(); }
  function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedSlot) return;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    void send('Booking details: ' + JSON.stringify({ slot_id: selectedSlot.id, ...fields }), `I'd like ${formatTime(selectedSlot.starts_at)}. Here are my contact details for review.`);
  }
  function submitLead(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void send('Lead details: ' + JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))), 'Please ask reception to follow up on my enquiry.'); }
  const latestAssistant = messages.map(m => m.role).lastIndexOf('assistant');
  return <>
    {!open && <div className={styles.launcher}><span>Care starts with a conversation.</span><button ref={launcherRef} className={styles.launchButton} onClick={onOpen} aria-label="Open clinic chat"><Icon name="chat" size={25} /><span>Let’s talk</span></button></div>}
    {open && <section className={styles.widget} aria-label="Clinic reception chat" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <header className={styles.header}><div className={styles.avatar}><Icon name="plus" size={25}/></div><div><strong>CareWell reception</strong><small><i /> {DEMO_MODE ? 'Demo assistant' : 'AI assistant'} · Here to help</small></div><button onClick={onClose} aria-label="Close chat" className={styles.iconButton}><Icon name="close" /></button></header>
      <div className={styles.notice}>Clinic information & appointments. For emergencies, call 1122.</div>
      <div className={styles.messages} ref={listRef} role="log" aria-live="polite" aria-relevant="additions">
        <div className={styles.date}>YOUR CONVERSATION WITH CAREWELL</div>
        {messages.map((message, i) => <div className={`${styles.message} ${message.role === 'user' ? styles.outgoing : styles.incoming}`} key={i}>
          <p>{message.content}</p>
          {message.actions?.map((action, n) => <div key={n}>
            {action.type === 'slots' && action.data.length > 0 && <div className={styles.slots}>{action.data.map(slot => <button key={slot.id} disabled={busy || i !== latestAssistant} onClick={() => { setShowLead(false); setSelectedSlot(slot); }}>{formatTime(slot.starts_at)}</button>)}<small>All times in Pakistan time (PKT)</small></div>}
            {action.type === 'confirm_booking' && <div className={styles.review}><strong>Review your appointment</strong><dl><dt>When</dt><dd>{formatTime(action.data.starts_at)} (PKT)</dd><dt>Name</dt><dd>{action.data.patient_name}</dd><dt>Email</dt><dd>{action.data.patient_email}</dd><dt>Phone</dt><dd>{action.data.patient_phone}</dd><dt>Reason</dt><dd>{action.data.reason}</dd></dl><button className={styles.primary} disabled={busy || i !== latestAssistant} onClick={() => void send('Confirm booking')}>Confirm booking <Icon name="check" size={16}/></button><button className={styles.textButton} disabled={busy || i !== latestAssistant} onClick={() => void send('Cancel booking')}>Cancel</button></div>}
            {action.type === 'booked' && <div className={styles.success}><Icon name="check" size={18}/><div><strong>You're booked</strong><br/>{formatTime(action.data.starts_at)} (PKT)<small>Reference: {action.data.id.slice(0, 8)}</small></div></div>}
          </div>)}
        </div>)}
        {selectedSlot && <form className={styles.form} onSubmit={submitBooking} aria-label="Booking details"><strong>Your visit · {formatTime(selectedSlot.starts_at)}</strong><label>Full name<input name="patient_name" required minLength={2} maxLength={100} autoComplete="name" /></label><label>Email<input name="patient_email" type="email" required maxLength={254} autoComplete="email" /></label><label>Phone<input name="patient_phone" type="tel" minLength={7} required maxLength={25} autoComplete="tel" /></label><label>Reason for visit<input name="reason" required minLength={2} maxLength={300} placeholder="e.g. General consultation" /></label><small>Please keep medical details private. This is a fictional demo.</small><button className={styles.primary} disabled={busy}>Review appointment <Icon name="arrow" size={16}/></button><button type="button" className={styles.textButton} onClick={() => setSelectedSlot(null)}>Back</button></form>}
        {showLead && <form className={styles.form} onSubmit={submitLead} aria-label="Reception enquiry"><strong>Leave an enquiry</strong><label>Your name<input name="name" required minLength={2} maxLength={100}/></label><label>Email or phone<input name="contact" required minLength={5} maxLength={254}/></label><label>How can reception help?<textarea name="message" required minLength={2} maxLength={1000} rows={3}/></label><button className={styles.primary} disabled={busy}>Send enquiry <Icon name="arrow" size={16}/></button><button type="button" className={styles.textButton} onClick={() => setShowLead(false)}>Back</button></form>}
        {busy && <div className={styles.typing} role="status" aria-label="Reception is typing"><i/><i/><i/></div>}
      </div>
      {error && <div className={styles.error} role="alert">{error}</div>}
      <div className={styles.quickReplies}>{['Opening hours', 'Book an appointment', 'Fees'].map(text => <button disabled={busy} key={text} onClick={() => void send(text)}>{text}</button>)}</div>
      <form className={styles.composer} onSubmit={e => { e.preventDefault(); void send(input); }}><label className="srOnly" htmlFor="chat-message">Message reception</label><input id="chat-message" ref={inputRef} value={input} onChange={e => setInput(e.target.value)} maxLength={2000} placeholder="Ask us anything about your visit…" disabled={busy}/><button className={styles.send} disabled={busy || !input.trim()} aria-label="Send message"><Icon name="send" size={18}/></button></form>
      <footer className={styles.footer}><button disabled={busy} onClick={() => { setSelectedSlot(null); setShowLead(true); }}>Leave an enquiry</button><span>Powered by ClinicDesk AI</span><button disabled={busy} onClick={reset} aria-label="Start new chat"><Icon name="refresh" size={14}/></button></footer>
    </section>}
  </>;
}
