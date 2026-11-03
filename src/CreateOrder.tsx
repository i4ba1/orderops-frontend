import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError, browserStorage, RequestIntent } from './api';
import type { CreateOrder, InventoryItem, Order, Scenario } from './api';
import { ErrorNotice, Icon, message, Modal } from './ui';

const newDraft = (): CreateOrder => ({ customerReference: '', shippingAddress: { recipient: '', line1: '', city: '', postalCode: '', country: '' }, demoScenario: 'NORMAL', items: [{ sku: '', quantity: 1 }] });
const scenarioHints: Record<Scenario, string> = {
  NORMAL: 'The carrier creates a shipment normally.',
  FAIL_THEN_RECOVER: 'The first fulfillment attempt exhausts its retries. Recover it from order details.',
  TIMEOUT_AFTER_CREATE: 'The carrier accepts the shipment before a timeout. Automatic retry reconciles the same shipment.',
};

export function CreateOrderForm({ username, open, inventory, onClose, onCreated, onAuthError }: { username: string; open: boolean; inventory: InventoryItem[]; onClose: () => void; onCreated: (order: Order) => void; onAuthError: (error: unknown) => void }) {
  const intent = useMemo(() => new RequestIntent<CreateOrder>(`${username}:create`, browserStorage()), [username]);
  const [draft, setDraft] = useState<CreateOrder>(() => intent.current?.payload ?? newDraft());
  const [uncertain, setUncertain] = useState(Boolean(intent.current));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const locked = busy || uncertain;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (!uncertain) {
      const requested = new Map<string, number>();
      for (const item of draft.items) requested.set(item.sku, (requested.get(item.sku) ?? 0) + item.quantity);
      for (const [sku, quantity] of requested) {
        const stock = inventory.find(item => item.sku === sku);
        if (!stock || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > stock.availableQuantity) { setError(`Check the quantity for ${sku || 'each product'}. Available stock may have changed.`); return; }
      }
    }
    setBusy(true);
    try {
      const payload = uncertain && intent.current ? intent.current.payload : {
        ...draft, customerReference: draft.customerReference.trim(),
        shippingAddress: Object.fromEntries(Object.entries(draft.shippingAddress).map(([key, value]) => [key, value.trim()])) as unknown as CreateOrder['shippingAddress'],
      };
      const request = intent.begin(payload);
      const order = await api.createOrder(request.payload, request.key);
      intent.clear(); setUncertain(false); setDraft(newDraft()); onCreated(order);
    } catch (cause) {
      const unknownOutcome = !(cause instanceof ApiError) || cause.uncertain;
      setUncertain(unknownOutcome);
      if (!unknownOutcome) intent.clear();
      setError(message(cause)); onAuthError(cause);
    } finally { setBusy(false); }
  }
  function reset() {
    intent.clear(); setDraft(newDraft()); setUncertain(false); setError(''); setDiscardConfirm(false);
  }
  const total = draft.items.reduce((sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0), 0);
  return <Modal open={open} title="New order" onClose={onClose} wide busy={busy}><form className="order-form" onSubmit={submit}>
    <div className="drawer-body"><p className="drawer-intro">Reserve the right stock. We’ll take care of fulfillment.</p>
      {uncertain && <div className="notice notice-warning" role="status"><Icon name="alert"/><div><strong>Request outcome unknown</strong><p>Your order may already exist. Retry the same request to retrieve it safely. Its details are preserved, including after a refresh.</p></div></div>}
      {error && <ErrorNotice>{error}</ErrorNotice>}
      <fieldset disabled={locked}><legend className="section-title"><span>01</span>Order details</legend><label>Customer reference<input autoComplete="off" required maxLength={100} placeholder="e.g. WEB-1042" value={draft.customerReference} onChange={event => setDraft({ ...draft, customerReference: event.target.value })}/><small>Your reference for this order.</small></label>
        <div className="section-heading"><h3>Products</h3><span>{draft.items.length} {draft.items.length === 1 ? 'line' : 'lines'}</span></div>
        {draft.items.map((item, index) => <div className="item-row" key={index}><label>Product {index + 1}<select required value={item.sku} onChange={event => setDraft({ ...draft, items: draft.items.map((line, row) => row === index ? { ...line, sku: event.target.value } : line) })}><option value="">Select a product</option>{inventory.map(product => <option key={product.sku} value={product.sku} disabled={product.availableQuantity === 0}>{product.name} · {product.availableQuantity} available</option>)}</select></label><label className="quantity-field">Quantity {index + 1}<input type="number" required min={1} max={2147483647} step={1} inputMode="numeric" value={Number.isNaN(item.quantity) ? '' : item.quantity} onChange={event => setDraft({ ...draft, items: draft.items.map((line, row) => row === index ? { ...line, quantity: event.target.valueAsNumber } : line) })}/></label><button className="icon-button remove-item" type="button" aria-label={`Remove product ${index + 1}`} disabled={draft.items.length === 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, row) => row !== index) })}><Icon name="close" size={17}/></button></div>)}
        {!inventory.length && <p className="form-hint">No inventory is available. Load inventory before creating an order.</p>}
        <button type="button" className="text-button add-line" disabled={draft.items.length >= 20} onClick={() => setDraft({ ...draft, items: [...draft.items, { sku: '', quantity: 1 }] })}><Icon name="plus" size={16}/>Add another product</button>
      </fieldset>
      <fieldset disabled={locked}><legend className="section-title"><span>02</span>Shipping address</legend><label>Recipient<input required maxLength={120} autoComplete="shipping name" placeholder="Full name" value={draft.shippingAddress.recipient} onChange={event => setDraft({ ...draft, shippingAddress: { ...draft.shippingAddress, recipient: event.target.value } })}/></label><label>Street address<input required maxLength={200} autoComplete="shipping street-address" placeholder="Street and building number" value={draft.shippingAddress.line1} onChange={event => setDraft({ ...draft, shippingAddress: { ...draft.shippingAddress, line1: event.target.value } })}/></label><div className="form-columns"><label>City<input required maxLength={100} autoComplete="shipping address-level2" placeholder="City" value={draft.shippingAddress.city} onChange={event => setDraft({ ...draft, shippingAddress: { ...draft.shippingAddress, city: event.target.value } })}/></label><label>Postal code<input required maxLength={32} autoComplete="shipping postal-code" placeholder="Postal code" value={draft.shippingAddress.postalCode} onChange={event => setDraft({ ...draft, shippingAddress: { ...draft.shippingAddress, postalCode: event.target.value } })}/></label></div><label className="country-field">Country code<input required minLength={2} maxLength={2} pattern="[A-Z]{2}" title="Two uppercase letters, such as GB, US or ID" autoComplete="shipping country" placeholder="GB" value={draft.shippingAddress.country} onChange={event => setDraft({ ...draft, shippingAddress: { ...draft.shippingAddress, country: event.target.value.toUpperCase() } })}/><small>Two-letter country code, e.g. GB, US or ID.</small></label></fieldset>
      <fieldset disabled={locked}><legend className="section-title"><span>03</span>Fulfillment scenario</legend><label>Scenario<select value={draft.demoScenario} onChange={event => setDraft({ ...draft, demoScenario: event.target.value as Scenario })}><option value="NORMAL">Normal fulfillment</option><option value="FAIL_THEN_RECOVER">Fail, then recover</option><option value="TIMEOUT_AFTER_CREATE">Timeout after shipment creation</option></select></label><p className="scenario-hint"><Icon name="clock" size={17}/>{scenarioHints[draft.demoScenario]}</p></fieldset>
      {uncertain && <div className="uncertain-actions">{discardConfirm ? <div className="notice notice-warning"><div><strong>Start a separate order?</strong><p>The original request may already have reserved stock. Check your orders first. A new draft creates a separate order.</p><div className="confirm-actions"><button className="button secondary" type="button" onClick={() => setDiscardConfirm(false)}>Keep request</button><button className="button warning" type="button" onClick={reset}>Start separate order</button></div></div></div> : <button type="button" className="text-button" onClick={() => setDiscardConfirm(true)}>Discard this request and start a new draft</button>}</div>}
    </div>
    <footer className="drawer-footer"><div><strong>{total} {total === 1 ? 'unit' : 'units'}</strong><span>Stock is reserved on confirmation</span></div><button className="button primary" type="submit" disabled={busy || (!inventory.length && !uncertain)}>{busy ? 'Submitting…' : uncertain ? 'Retry same request' : 'Create order'}<Icon name="arrow" size={17}/></button></footer>
  </form></Modal>;
}
