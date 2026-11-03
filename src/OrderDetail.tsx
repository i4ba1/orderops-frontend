import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, browserStorage, RequestIntent } from './api';
import type { Order } from './api';
import { date, ErrorNotice, Icon, message, Modal, Status } from './ui';

export function OrderDetail({ id, username, operator, onClose, onChanged, onAuthError }: { id: string; username: string; operator: boolean; onClose: () => void; onChanged: () => void; onAuthError: (error: unknown) => void }) {
  const [order, setOrder] = useState<Order>();
  const [error, setError] = useState('');
  const [retryError, setRetryError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const intent = useMemo(() => new RequestIntent<{ orderId: string }>(`${username}:retry:${id}`, browserStorage()), [id, username]);
  const [uncertain, setUncertain] = useState(Boolean(intent.current));
  useEffect(() => {
    let active = true;
    async function load() {
      try { const value = await api.order(id); if (active) { setOrder(value); setError(''); } }
      catch (cause) { if (active) { setError(message(cause)); onAuthError(cause); } }
    }
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 4_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, refresh, onAuthError]);
  async function retry() {
    if (busy) return;
    setBusy(true); setRetryError(''); setNotice('');
    try {
      const request = intent.begin({ orderId: id });
      const value = await api.retry(id, request.key);
      intent.clear(); setUncertain(false); setOrder(value); setNotice('Recovery requested. Fulfillment will continue automatically.'); onChanged();
    } catch (cause) {
      const unknownOutcome = !(cause instanceof ApiError) || cause.uncertain;
      setUncertain(unknownOutcome);
      if (!unknownOutcome) intent.clear();
      setRetryError(message(cause)); onAuthError(cause);
    } finally { setBusy(false); }
  }
  return <Modal open title={order?.customerReference ?? 'Order details'} label={order ? `Order ${order.customerReference}` : 'Order details'} onClose={onClose} busy={busy}>
    <div className="drawer-body detail-body">{error && <ErrorNotice retry={() => setRefresh(value => value + 1)}>{error}</ErrorNotice>}{!order && !error && <div className="loading-block" role="status"><span className="spinner"/>Loading order details…</div>}{order && <>
      <div className="detail-status"><Status status={order.status}/><span>Attempt {order.attemptGeneration}</span></div><div className="detail-id mono">{order.id}</div>
      {notice && <div className="notice notice-success" role="status"><Icon name="check"/><div>{notice}</div></div>}
      {(order.status === 'FULFILLMENT_FAILED' || uncertain) && <div className="recovery-card"><span className="recovery-icon"><Icon name="alert" size={23}/></span><h3>{uncertain ? 'Recovery outcome unknown' : 'Let’s get this moving again.'}</h3><p>{uncertain ? 'Retry the same recovery request to safely confirm its result.' : 'Shipment creation needs attention. Stock remains reserved for this order.'}</p>{retryError && <ErrorNotice>{retryError}</ErrorNotice>}{operator ? <button className="button warning" onClick={retry} disabled={busy}><Icon name="refresh" size={17}/>{busy ? 'Requesting recovery…' : uncertain ? 'Retry same recovery request' : 'Retry fulfillment'}</button> : <p className="viewer-note">An operator can retry fulfillment.</p>}</div>}
      {retryError && order.status !== 'FULFILLMENT_FAILED' && !uncertain && <ErrorNotice>{retryError}</ErrorNotice>}
      {order.trackingNumber && <div className="shipment-card"><span className="shipment-icon"><Icon name="check"/></span><div><h3>Shipment created</h3><p>Carrier reference</p><strong className="mono tracking">{order.trackingNumber}</strong><p className="form-hint">The carrier accepted the request. This does not indicate dispatch or delivery.</p></div></div>}
      <section className="detail-section"><h3>Order items<span>{order.items.reduce((sum, item) => sum + item.quantity, 0)} units</span></h3>{order.items.map((item, index) => <div className="detail-item" key={`${item.sku}-${index}`}><span className="product-icon"><Icon name="box" size={20}/></span><strong className="mono">{item.sku}</strong><span>Qty <b>{item.quantity}</b></span></div>)}</section>
      <section className="detail-section"><h3>Shipping address</h3><address><strong>{order.shippingAddress.recipient}</strong><br/>{order.shippingAddress.line1}<br/>{order.shippingAddress.city}, {order.shippingAddress.postalCode}<br/>{order.shippingAddress.country}</address></section>
      <section className="detail-section"><h3>Activity timeline</h3>{order.timeline.length ? <ol className="timeline">{[...order.timeline].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((event, index) => <li key={event.id}><span className={`timeline-dot ${index === order.timeline.length - 1 ? 'latest' : ''}`}/><div><strong>{event.type.replace(/([a-z])([A-Z])/g, '$1 $2')}</strong><p>{event.message}</p><time dateTime={event.occurredAt}>{date(event.occurredAt)}</time></div></li>)}</ol> : <p className="muted">No activity recorded yet.</p>}</section>
      <dl className="order-meta"><div><dt>Created</dt><dd>{date(order.createdAt)}</dd></div><div><dt>Scenario</dt><dd>{order.demoScenario === 'NORMAL' ? 'Normal fulfillment' : order.demoScenario === 'FAIL_THEN_RECOVER' ? 'Fail, then recover' : 'Timeout after creation'}</dd></div>{order.shipmentId && <div><dt>Shipment ID</dt><dd className="mono">{order.shipmentId}</dd></div>}</dl>
    </>}</div><footer className="drawer-footer detail-footer"><span><span className="live-dot"/>Activity updates automatically</span><button className="button secondary" onClick={onClose} disabled={busy}>Done</button></footer>
  </Modal>;
}
