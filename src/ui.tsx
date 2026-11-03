import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { OrderStatus } from './api';

export type IconName = 'grid' | 'box' | 'orders' | 'plus' | 'arrow' | 'close' | 'refresh' | 'check' | 'alert' | 'logout' | 'chevron' | 'clock';
const paths: Record<IconName, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  box: <><path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5"/></>,
  orders: <><rect x="5" y="3" width="14" height="19" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 7a7 7 0 0 1 11.5-1L20 9M4 15l2.4 3A7 7 0 0 0 18 17"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  alert: <><path d="m10.3 4-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
  logout: <><path d="M9 4H4v16h5M10 12h11m-5-5 5 5-5 5"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
export function Brand() { return <span className="brand"><span className="brand-mark"><Icon name="box" size={22}/></span><span>order<span className="brand-light">ops</span><span className="brand-dot">.</span></span></span>; }
export function Status({ status }: { status: OrderStatus }) {
  return <span className={`status status-${status.toLowerCase()}`}><span/>{status === 'SHIPMENT_CREATED' ? 'Shipment created' : status === 'FULFILLMENT_FAILED' ? 'Needs attention' : 'Confirmed'}</span>;
}
export function ErrorNotice({ children, retry }: { children: ReactNode; retry?: () => void }) {
  return <div className="notice notice-error" role="alert"><Icon name="alert"/><div>{children}</div>{retry && <button className="text-button" onClick={retry}>Try again</button>}</div>;
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name="box" size={30}/></span><h3>{title}</h3><p>{children}</p>{action}</div>;
}
export function Modal({ open, title, label, onClose, children, wide = false, busy = false }: { open: boolean; title: string; label?: string; onClose: () => void; children: ReactNode; wide?: boolean; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && dialog && !dialog.open) dialog.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className={`drawer ${wide ? 'drawer-wide' : ''}`} aria-label={label ?? title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header className="drawer-header"><div><span className="eyebrow">ORDER DESK</span><h2>{title}</h2></div><button className="icon-button" aria-label={title === 'New order' ? 'Close new order' : 'Close order details'} disabled={busy} onClick={onClose}><Icon name="close"/></button></header>
    {children}
  </dialog>;
}
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function date(value: string) { const parsed = new Date(value); return Number.isNaN(parsed.valueOf()) ? value : dateFormat.format(parsed); }
export function message(error: unknown) { return error instanceof Error ? error.message : 'Something went wrong. Please try again.'; }
