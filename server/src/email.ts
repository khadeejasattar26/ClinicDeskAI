import { randomUUID } from 'crypto';
import { Resend } from 'resend';
import type { Config } from './config';
import type { Repository } from './repository';
import { logger } from './logger';
export interface Email { to: string; subject: string; text: string; idempotencyKey: string }
export interface Mailer { send(email: Email): Promise<void> }
export class ClinicMailer implements Mailer {
  private client: Resend | null;
  constructor(private config: Config, client?: Resend) { this.client = client ?? (config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null); }
  async send(email: Email) {
    if (!this.client) { logger.info({ emailPreview: email }, 'Email preview: configure Resend for delivery'); return; }
    const result = await this.client.emails.send({ from: this.config.EMAIL_FROM, to: email.to, subject: email.subject, text: email.text }, { idempotencyKey: email.idempotencyKey });
    if (result.error) throw new Error('Email provider unavailable');
  }
}
export class EmailService {
  constructor(private repo: Repository, private mailer: Mailer) {}
  async sendPending(appointmentId?: string) {
    const token = randomUUID();
    const rows = await this.repo.claimEmails(token, appointmentId);
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const appointment = await this.repo.appointment(row.clinic_id, row.appointment_id);
        const clinic = await this.repo.clinic(row.clinic_id);
        if (appointment.status !== 'confirmed') { await this.repo.finishEmail(row.id, token, true); continue; }
        const when = new Intl.DateTimeFormat('en-PK', { dateStyle: 'full', timeStyle: 'short', timeZone: clinic.timezone }).format(new Date(appointment.starts_at));
        await this.mailer.send({ to: appointment.patient_email, subject: `${row.kind === 'confirmation' ? 'Appointment confirmed' : 'Appointment reminder'} · ${clinic.name}`, text: `Hello ${appointment.patient_name},\n\nYour appointment at ${clinic.name} is confirmed for ${when} (Pakistan time).\nFor changes, please contact reception. Please do not reply with medical information.\n\nCareWell reception`, idempotencyKey: `clinicdesk/${row.id}` });
        await this.repo.finishEmail(row.id, token, true);
        sent++;
      } catch {
        await this.repo.finishEmail(row.id, token, false);
        logger.warn({ emailId: row.id }, 'Email queued for retry');
        failed++;
      }
    }
    return { sent, failed };
  }
}
