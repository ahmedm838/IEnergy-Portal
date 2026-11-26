import { Button } from './ui'

/*
 * WhatsApp click-to-chat, shared by the Employees page and the employee
 * report. Nothing is sent by the portal -- WhatsApp opens on the HR
 * user's own account with the message typed in, and they press send.
 */

/* The personal mobile, falling back to the company one. Both are stored
   as 010-1234-5678; WhatsApp wants 201012345678. */
export function whatsAppNumber(employee) {
  for (const raw of [employee?.personal_mobile, employee?.company_mobile]) {
    const digits = String(raw ?? '').replace(/\D/g, '')
    if (/^01\d{9}$/.test(digits)) return `2${digits}`
    if (/^201\d{9}$/.test(digits)) return digits
  }
  return null
}

/* The leave balance message. `rows` are [label, balance, consumed,
   remaining]; `others` are [label, days] for leave that comes off no
   balance, listed only when there are any. */
export function leaveBalanceMessage({ name, year, rows, others = [] }) {
  return [
    `السيد ${name}،`,
    `بيان رصيد إجازاتك لعام ${year} (بالأيام):`,
    ...rows.flatMap(([label, start, used, left]) =>
      ['', `*${label}*`, `الرصيد: ${start} | المستهلك: ${used} | المتبقي: ${left}`]),
    ...(others.length
      ? ['', '*إجازات أخرى مستهلكة*', ...others.map(([label, days]) => `- ${label}: ${days} يوم`)]
      : []),
    '',
    'مع تحيات إدارة الموارد البشرية',
  ].join('\n')
}

const isMobileDevice = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

export default function WhatsAppButton({
  phone,
  message,
  label = 'Send',
  title = 'Open WhatsApp with the leave balance ready to send',
}) {
  if (!phone) return <span className="text-xs text-ink-4" title="No valid mobile number on record">No number</span>
  function open() {
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
    // Phone: the same tab, which hands straight over to the WhatsApp app.
    // Computer: a new tab, where WhatsApp offers its desktop app or
    // WhatsApp Web, and the portal stays open behind it.
    if (isMobileDevice()) window.location.href = url
    else window.open(url, '_blank', 'noopener')
  }
  return (
    <Button size="sm" variant="secondary" onClick={open} disabled={!message} title={title}>
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="#25D366">
        <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.1 5.1 0 0 0 1.1 2.7 11.6 11.6 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z" />
      </svg>
      {label}
    </Button>
  )
}
