// Auto-saves in-progress form data to localStorage so it survives a mobile
// browser tab being reloaded (e.g. when someone switches to WhatsApp mid-enquiry
// and Android reclaims the tab's memory). Drafts are scoped per tenant + user +
// form type (+ record id for edits) so different staff on a shared device never
// see each other's drafts.

const PREFIX = 'hc_draft_'
const DEFAULT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 3 // 3 days — an old abandoned draft shouldn't resurface indefinitely

export function draftKey(tenantId: string, userId: string, formType: string, recordId?: string): string {
  return `${PREFIX}${tenantId}_${userId}_${formType}${recordId ? '_' + recordId : ''}`
}

export function saveDraft(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ data, savedAt: Date.now() }))
  } catch {
    // localStorage can throw (quota exceeded, private browsing) — drafts are
    // a convenience, not critical, so fail silently rather than breaking the form
  }
}

export function loadDraft<T>(key: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) return null
    if (parsed.savedAt && Date.now() - parsed.savedAt > maxAgeMs) {
      localStorage.removeItem(key)
      return null
    }
    return parsed.data as T
  } catch {
    return null
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}