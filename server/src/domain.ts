export interface Clinic { id: string; name: string; timezone: string }
export interface Document { id: string; clinic_id: string; title: string; content: string; embedding?: number[]; similarity?: number }
export interface Slot { id: string; clinic_id: string; starts_at: string; is_booked: boolean }
export interface BookingInput { slot_id: string; patient_name: string; patient_email: string; patient_phone: string; reason: string }
export interface Conversation { id: string; clinic_id: string; status: 'active' | 'follow_up'; handoff_reason: string | null; pending_booking: BookingInput | null; created_at: string }
export interface Message { id: string; conversation_id: string; role: 'user' | 'assistant'; content: string; created_at: string }
export interface Usage { id?: string; conversation_id: string; model: string; prompt_tokens: number; completion_tokens: number; latency_ms: number; estimated_cost_usd: number; created_at?: string }
export interface Action { type: string; data: unknown }
