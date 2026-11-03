import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, ApiError } from './api';
import type { InventoryItem, OrderPage, Session } from './api';
import { Brand, date, Empty, ErrorNotice, Icon, message, Status } from './ui';
import type { IconName } from './ui';
import { CreateOrderForm } from './CreateOrder';
import { OrderDetail } from './OrderDetail';

type View = 'overview' | 'orders' | 'inventory';
export default function App() {
  const [session, setSession] = useState<Session | null>();
  const [bootError, setBootError] = useState('');
  const [boot, setBoot] = useState(0);
  useEffect(() => {
    let active = true;
    setBootError('');
    api.session().then(value => { if (active) setSession(value); }).catch(error => {
      if (!active) return;
      if (error instanceof ApiError && error.status === 401) setSession(null);
      else setBootError(message(error));
    });
    return () => { active = false; };
  }, [boot]);
  if (session === undefined) return <main className="boot"><Brand/>{bootError ? <ErrorNotice retry={() => setBoot(value => value + 1)}>{bootError}</ErrorNotice> : <p className="loading">Opening your workspace…</p>}</main>;
  if (!session) return <Login onLogin={setSession}/>;
  return <Workspace key={session.username} session={session} onSignOut={() => setSession(null)}/>;
}

function Login({ onLogin }: { onLogin: (session: Session) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api.login(username.trim(), password); onLogin(await api.session()); }
    catch (cause) { setError(cause instanceof ApiError && cause.status === 401 ? 'Username or password is incorrect.' : message(cause)); }
    finally { setBusy(false); }
  }
  return <main className="login-layout"><section className="login-story"><Brand/><div className="login-copy"><span className="eyebrow">A LITTLE ORDER. A LOT OF CLARITY.</span><h1>Keep every order<br/>moving forward.</h1><p>Your inventory, orders, and fulfillment.<br/>One calm place to keep things on track.</p><div className="story-steps"><span><Icon name="check"/>Reserve stock</span><span><Icon name="check"/>Create shipments</span><span><Icon name="check"/>Recover with confidence</span></div></div><span className="login-footer">RETAIL OPERATIONS, SIMPLIFIED</span></section>
    <section className="login-panel"><form onSubmit={submit} className="login-form"><span className="eyebrow">YOUR WORKSPACE AWAITS</span><h2>Welcome back.</h2><p>Sign in to your OrderOps workspace.</p>{error && <ErrorNotice>{error}</ErrorNotice>}<label>Username<input autoComplete="username" required value={username} onChange={event => setUsername(event.target.value)} disabled={busy} placeholder="Your username"/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} placeholder="Your password"/></label><button className="button primary login-submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<Icon name="arrow"/></button><p className="form-hint">Use the account provided by your workspace administrator.</p></form></section>
  </main>;
}

function Workspace({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [view, setView] = useState<View>('overview');
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [orders, setOrders] = useState<OrderPage>();
  const [inventory, setInventory] = useState<InventoryItem[]>();
  const [ordersError, setOrdersError] = useState('');
  const [inventoryError, setInventoryError] = useState('');
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>();
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [notice, setNotice] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const operator = session.role === 'OPERATOR';
  const refreshData = useCallback(() => setRefresh(value => value + 1), []);
  const handleAuth = useCallback((error: unknown) => { if (error instanceof ApiError && error.status === 401) onSignOut(); }, [onSignOut]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refreshData(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [refreshData]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    api.orders(page).then(value => { if (active) { setOrders(value); setOrdersError(''); setLastUpdate(new Date()); } }).catch(error => { if (active) { setOrdersError(message(error)); handleAuth(error); } }).finally(() => { if (active) setLoading(false); });
    api.inventory().then(value => { if (active) { setInventory(value); setInventoryError(''); } }).catch(error => { if (active) { setInventoryError(message(error)); handleAuth(error); } });
    return () => { active = false; };
  }, [page, refresh, handleAuth]);

  async function logout() {
    setSigningOut(true); setNotice('');
    try { await api.logout(); onSignOut(); } catch (error) { setNotice(message(error)); handleAuth(error); } finally { setSigningOut(false); }
  }
  const nav: { view: View; label: string; icon: IconName }[] = [{ view: 'overview', label: 'Overview', icon: 'grid' }, { view: 'orders', label: 'Orders', icon: 'orders' }, { view: 'inventory', label: 'Inventory', icon: 'box' }];
  const visibleOrders = orders?.number === page ? orders.content : [];
  const failed = visibleOrders?.filter(order => order.status === 'FULFILLMENT_FAILED').length ?? 0;
  const shipped = visibleOrders?.filter(order => order.status === 'SHIPMENT_CREATED').length ?? 0;
  const title = view === 'overview' ? 'Operations overview' : view === 'orders' ? 'Orders' : 'Inventory';

  return <div className="app-shell"><a className="skip-link" href="#workspace">Skip to workspace</a><aside className="sidebar"><Brand/><span className="sidebar-label">WORKSPACE</span><nav aria-label="Main navigation">{nav.map(item => <button key={item.view} className={`nav-item ${view === item.view ? 'active' : ''}`} aria-current={view === item.view ? 'page' : undefined} onClick={() => setView(item.view)}><Icon name={item.icon}/><span>{item.label}</span>{item.view === 'orders' && orders && <span className="nav-count">{orders.totalElements}</span>}</button>)}</nav><div className="sidebar-bottom"><div className="workspace-note"><span className="live-dot"/><div><strong>One connected workflow</strong><span>From reservation to shipment.</span></div></div><div className="profile"><span className="avatar">{session.username.slice(0, 2).toUpperCase()}</span><span><strong>{session.username}</strong><small>{operator ? 'Operator' : 'Viewer'}</small></span><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={logout} disabled={signingOut}><Icon name="logout" size={18}/></button></div></div></aside>
    <div className="main-column"><header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{nav.find(item => item.view === view)?.label}</strong></div><div className="topbar-right"><span className="live-label"><span className="live-dot"/>Auto-updates every 5s</span><span className={`role-chip ${operator ? '' : 'viewer'}`}>{operator ? 'Operator access' : 'Read-only access'}</span></div></header>
      <main id="workspace" className="workspace"><div className="page-heading"><div><span className="eyebrow">YOUR DAILY OPERATIONS, IN VIEW</span><h1>{title}<span className="heading-dot" aria-hidden="true">.</span></h1><p>{view === 'inventory' ? 'Available stock, ready for the next order.' : 'A clear view of your orders, from stock to shipment.'}</p></div>{operator && <button className="button primary" onClick={() => setCreateOpen(true)}><Icon name="plus" size={18}/>New order</button>}</div>
        {notice && <ErrorNotice>{notice}</ErrorNotice>}
        {view === 'overview' && <><section className="metrics" aria-label="Operations metrics"><Metric title="Total orders" value={orders?.totalElements} foot="Across your workspace" icon="orders"/><Metric title="Shipment created" value={orders ? shipped : undefined} foot="On this order page" icon="check" tone="teal"/><Metric title="Needs attention" value={orders ? failed : undefined} foot="On this order page" icon="alert" tone="amber"/><Metric title="Available stock" value={inventory?.reduce((sum, item) => sum + item.availableQuantity, 0)} foot={`${inventory?.length ?? '—'} products in inventory`} icon="box"/></section>
          <div className="overview-note"><span className="note-icon"><Icon name="arrow" size={18}/></span><p><strong>Every order has a next step.</strong> Confirmed orders reserve stock automatically. Failed fulfillment can be recovered from order details.</p></div></>}
        {view !== 'inventory' && <section className="panel orders-panel"><div className="panel-heading"><div><h2>{view === 'overview' ? 'Recent orders' : 'All orders'}<span className="count-chip">{orders?.totalElements ?? '—'}</span></h2><p>Follow the progress. Keep things moving.</p></div><button className={`icon-button ${loading ? 'is-refreshing' : ''}`} aria-label="Refresh orders" title="Refresh orders" onClick={refreshData} disabled={loading}><Icon name="refresh" size={18}/></button></div>
          {ordersError && <div className="panel-notice"><ErrorNotice retry={refreshData}>{orders ? 'Updates paused. ' : ''}{ordersError}</ErrorNotice></div>}
          {loading && (!orders || orders.number !== page) ? <div className="loading-block" role="status"><span className="spinner"/>Loading orders…</div> : visibleOrders?.length ? <><div className="table-scroll"><table><thead><tr><th>Order reference</th><th>Items</th><th>Created</th><th>Status</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{visibleOrders.map(order => <tr key={order.id}><td><button className="order-link" aria-label={`View order ${order.customerReference}`} onClick={() => setSelected(order.id)}>{order.customerReference}</button><span className="table-secondary mono">{order.id.slice(0, 8)}</span></td><td>{order.items.reduce((sum, item) => sum + item.quantity, 0)} <span className="muted">units</span><span className="table-secondary">{order.items.length} {order.items.length === 1 ? 'product' : 'products'}</span></td><td className="date-cell">{date(order.createdAt)}</td><td><Status status={order.status}/></td><td><button className="icon-button row-arrow" aria-label={`Open details for ${order.customerReference}`} onClick={() => setSelected(order.id)}><Icon name="arrow" size={18}/></button></td></tr>)}</tbody></table></div><footer className="table-footer"><span>{page * 10 + 1}–{Math.min((page + 1) * 10, orders?.totalElements ?? 0)} of {orders?.totalElements} orders</span><div className="pagination"><button className="icon-button previous" aria-label="Previous page" onClick={() => setPage(value => value - 1)} disabled={page === 0 || loading}><Icon name="chevron" size={16}/></button><span>Page {page + 1} of {Math.max(orders?.totalPages ?? 1, 1)}</span><button className="icon-button" aria-label="Next page" onClick={() => setPage(value => value + 1)} disabled={loading || page + 1 >= (orders?.totalPages ?? 0)}><Icon name="chevron" size={16}/></button></div></footer></> : !ordersError && <Empty title="A clean slate for your orders">Create your first order to reserve stock and start fulfillment.{operator && <button className="button secondary empty-action" onClick={() => setCreateOpen(true)}><Icon name="plus" size={17}/>Create your first order</button>}</Empty>}
        </section>}
        {view === 'inventory' && <section className="panel"><div className="panel-heading"><div><h2>Stock availability<span className="count-chip">{inventory?.length ?? '—'}</span></h2><p>Quantities available for new reservations.</p></div><button className="icon-button" aria-label="Refresh inventory" onClick={refreshData}><Icon name="refresh" size={18}/></button></div>{inventoryError && <div className="panel-notice"><ErrorNotice retry={refreshData}>{inventoryError}</ErrorNotice></div>}{!inventory && !inventoryError ? <div className="loading-block" role="status">Loading inventory…</div> : inventory?.length ? <div className="inventory-grid">{inventory.map(item => <article className="inventory-card" key={item.sku}><div className="inventory-card-top"><span className="product-icon"><Icon name="box" size={24}/></span><span className={`stock-label ${item.availableQuantity === 0 ? 'out' : ''}`}>{item.availableQuantity === 0 ? 'Out of stock' : 'Available'}</span></div><h3>{item.name}</h3><span className="sku mono">{item.sku}</span><div className="stock-quantity">{item.availableQuantity.toLocaleString()}<span>units available</span></div></article>)}</div> : !inventoryError && <Empty title="No inventory yet">Products will appear here once inventory has been loaded.</Empty>}</section>}
        <footer className="workspace-footer"><span>OrderOps <span className="footer-divider">/</span> A little order goes a long way.</span><span>{lastUpdate ? `Last synced ${lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Connecting to your workspace'}</span></footer>
      </main>
    </div>
    {operator && <CreateOrderForm username={session.username} open={createOpen} inventory={inventory ?? []} onClose={() => setCreateOpen(false)} onCreated={order => { setCreateOpen(false); setPage(0); setSelected(order.id); refreshData(); }} onAuthError={handleAuth}/>}
    {selected && <OrderDetail key={selected} id={selected} username={session.username} operator={operator} onClose={() => setSelected(undefined)} onChanged={refreshData} onAuthError={handleAuth}/>}
  </div>;
}

function Metric({ title, value, foot, icon, tone = '' }: { title: string; value?: number; foot: string; icon: IconName; tone?: string }) {
  return <article className={`metric ${tone}`}><div className="metric-top"><h2>{title}</h2><span className="metric-icon"><Icon name={icon} size={19}/></span></div><strong className="metric-value">{value?.toLocaleString() ?? '—'}</strong><p>{foot}</p></article>;
}
