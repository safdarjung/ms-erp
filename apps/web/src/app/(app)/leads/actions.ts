'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { leadInput, LEAD_STAGES, LEAD_ACTIVITY_TYPES, type LeadInput } from '@ms/core';
import { withTenant, lead, leadActivity, customer, eq, ilike, or, sql } from '@ms/db';
import { requirePermission } from '@/lib/rbac';
import { createLeadRecord } from '@/lib/documents';
import { toActionError, fieldError, UserError, type ActionResult } from '@/lib/forms';

export type ActionState = { error?: string; field?: string; ok?: boolean; message?: string };

/** Stage change result — carries what the UI needs for the "Won 🎉" nudge. */
export type StageResult = ActionResult & { customerName?: string; convertedCustomerId?: string | null };

const NOT_FOUND = "Couldn't find that enquiry — it may have been deleted. Refresh and try again.";
const NAME_REQUIRED = "Enter the company or person's name";
const DEFAULT_STATE_CODE = '06';
const OTHER_SOURCE = 'Other';

const last10Digits = (phone: string | null | undefined) => (phone ?? '').replace(/\D+/g, '').slice(-10);

/** "Other…" in the Source select means: use the free-text box next to it. */
function resolveSource(formData: FormData): string {
  const source = String(formData.get('source') ?? '').trim();
  const other = String(formData.get('sourceOther') ?? '').trim();
  return source === OTHER_SOURCE ? other : source;
}

type ParsedLead = LeadInput & { nextFollowupAt: string | null };

function parseLead(formData: FormData): { data: ParsedLead } | { error: ActionState } {
  const raw: Record<string, unknown> = Object.fromEntries(formData);
  if (!String(raw.customerName ?? '').trim()) return { error: { error: NAME_REQUIRED, field: 'customerName' } };
  raw.source = resolveSource(formData);
  const parsed = leadInput.safeParse(raw);
  if (!parsed.success) return { error: fieldError(parsed.error.issues[0]) };
  const followup = String(formData.get('nextFollowupAt') ?? '').trim();
  if (followup && Number.isNaN(Date.parse(followup))) {
    return { error: { error: 'Follow-up date: pick a date from the calendar.', field: 'nextFollowupAt' } };
  }
  return { data: { ...parsed.data, nextFollowupAt: followup || null } };
}

export async function createLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const u = await requirePermission('lead.create');
    const parsed = parseLead(formData);
    if ('error' in parsed) return parsed.error;
    const d = parsed.data;
    await withTenant(u.tenantId, u.userId, (tx) =>
      createLeadRecord(tx, u.tenantId, { ...d, ownerUserId: u.userId }),
    );
    revalidatePath('/leads');
    return { ok: true, message: 'Enquiry saved' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

export async function updateLeadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const u = await requirePermission('lead.edit');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: NOT_FOUND };
    const parsed = parseLead(formData);
    if ('error' in parsed) return parsed.error;
    const d = parsed.data;
    const [row] = await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(lead).set({
        customerName: d.customerName, contact: d.contact, phone: d.phone, email: d.email,
        source: d.source, requirement: d.requirement, stage: d.stage,
        valueEstimate: d.valueEstimate != null ? String(d.valueEstimate) : null,
        nextFollowupAt: d.nextFollowupAt ? new Date(d.nextFollowupAt) : null,
        updatedAt: new Date(),
      }).where(eq(lead.id, id)).returning({ id: lead.id }),
    );
    if (!row) return { error: NOT_FOUND };
    revalidatePath('/leads');
    revalidatePath(`/leads/${id}`);
    return { ok: true, message: 'Enquiry saved' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

/**
 * Save a note (call / email / meeting / note) and optionally move the next
 * follow-up: a date sets it, `clearFollowup=1` removes it, neither leaves it.
 */
export async function addLeadActivityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const u = await requirePermission('lead.edit');
    const id = String(formData.get('leadId') ?? '');
    const rawType = String(formData.get('type') ?? 'note');
    const type = (LEAD_ACTIVITY_TYPES as readonly string[]).includes(rawType) ? rawType : 'note';
    const notes = String(formData.get('notes') ?? '').trim();
    const followupRaw = String(formData.get('nextFollowupAt') ?? '').trim();
    const clearFollowup = String(formData.get('clearFollowup') ?? '') === '1';
    if (!id) return { error: NOT_FOUND };
    if (!notes && rawType !== type) {
      return { error: 'Write a short note first — e.g. "Called, sending revised rate".', field: 'notes' };
    }
    if (followupRaw && Number.isNaN(Date.parse(followupRaw))) {
      return { error: 'Follow-up date: pick a date from the calendar.', field: 'nextFollowupAt' };
    }

    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [l] = await tx.select({ id: lead.id }).from(lead).where(eq(lead.id, id)).limit(1);
      if (!l) throw new UserError(NOT_FOUND);
      await tx.insert(leadActivity).values({
        tenantId: u.tenantId, leadId: id, type, notes: notes || null, byUserId: u.userId,
      });
      if (followupRaw) {
        await tx.update(lead).set({ nextFollowupAt: new Date(followupRaw), updatedAt: new Date() }).where(eq(lead.id, id));
      } else if (clearFollowup) {
        await tx.update(lead).set({ nextFollowupAt: null, updatedAt: new Date() }).where(eq(lead.id, id));
      }
    });
    revalidatePath(`/leads/${id}`);
    revalidatePath('/leads');
    return { ok: true, message: 'Note saved' };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

export async function assignLeadAction(id: string, userId: string): Promise<ActionResult> {
  try {
    const u = await requirePermission('lead.edit');
    if (!id) return { error: NOT_FOUND };
    const [row] = await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(lead).set({ ownerUserId: userId || null, updatedAt: new Date() })
        .where(eq(lead.id, id)).returning({ id: lead.id }),
    );
    if (!row) return { error: NOT_FOUND };
    revalidatePath(`/leads/${id}`);
    return { ok: true };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

export async function setLeadStageAction(id: string, stage: string): Promise<StageResult> {
  try {
    const u = await requirePermission('lead.edit');
    if (!id || !(LEAD_STAGES as readonly string[]).includes(stage)) return { error: 'Pick a stage from the list.' };
    const [row] = await withTenant(u.tenantId, u.userId, (tx) =>
      tx.update(lead).set({ stage, updatedAt: new Date() }).where(eq(lead.id, id))
        .returning({ customerName: lead.customerName, convertedCustomerId: lead.convertedCustomerId }),
    );
    if (!row) return { error: NOT_FOUND };
    revalidatePath('/leads');
    revalidatePath(`/leads/${id}`);
    return { ok: true, customerName: row.customerName, convertedCustomerId: row.convertedCustomerId };
  } catch (e) {
    return { error: toActionError(e) };
  }
}

/**
 * Won enquiry → customer. Reuses an existing customer with the same name or
 * phone so converting twice never makes a twin; carries over contact, phone
 * and email. Lands on the new customer's page (`?from=lead`).
 */
export async function convertLeadToCustomerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  let customerId: string | null = null;
  try {
    const u = await requirePermission('customer.create');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: NOT_FOUND };

    customerId = await withTenant(u.tenantId, u.userId, async (tx) => {
      const [l] = await tx.select().from(lead).where(eq(lead.id, id)).limit(1);
      if (!l) throw new UserError(NOT_FOUND);
      if (l.convertedCustomerId) return l.convertedCustomerId;

      const p10 = last10Digits(l.phone);
      const matches = [ilike(customer.name, l.customerName)];
      if (p10.length === 10) {
        matches.push(sql`right(regexp_replace(coalesce(${customer.phone}, ''), '\\D', '', 'g'), 10) = ${p10}`);
      }
      const [existing] = await tx.select({ id: customer.id }).from(customer).where(or(...matches)).limit(1);
      let cid = existing?.id;
      if (!cid) {
        const [c] = await tx.insert(customer).values({
          tenantId: u.tenantId,
          name: l.customerName,
          contactPerson: l.contact,
          phone: l.phone,
          email: l.email,
          regType: 'unregistered',
          stateCode: DEFAULT_STATE_CODE,
        }).returning({ id: customer.id });
        cid = c!.id;
      }
      await tx.update(lead)
        .set({ stage: 'won', convertedCustomerId: cid, updatedAt: new Date() })
        .where(eq(lead.id, id));
      return cid;
    });

    revalidatePath('/leads');
    revalidatePath(`/leads/${id}`);
    revalidatePath('/customers');
  } catch (e) {
    return { error: toActionError(e) };
  }
  redirect(`/customers/${customerId}?from=lead`);
}

/** Delete an enquiry that never became a customer, with its notes. */
export async function deleteLeadAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const u = await requirePermission('lead.delete');
    const id = String(formData.get('id') ?? '');
    if (!id) return { error: NOT_FOUND };
    await withTenant(u.tenantId, u.userId, async (tx) => {
      const [l] = await tx.select({ id: lead.id, convertedCustomerId: lead.convertedCustomerId })
        .from(lead).where(eq(lead.id, id)).limit(1);
      if (!l) throw new UserError(NOT_FOUND);
      if (l.convertedCustomerId) {
        throw new UserError("This enquiry is already a customer, so it can't be deleted. Mark it Lost instead if it's closed.");
      }
      await tx.delete(leadActivity).where(eq(leadActivity.leadId, id));
      await tx.delete(lead).where(eq(lead.id, id));
    });
    revalidatePath('/leads');
    revalidatePath('/leads/inbox');
    revalidatePath('/dashboard');
  } catch (e) {
    return { error: toActionError(e) };
  }
  redirect('/leads');
}
