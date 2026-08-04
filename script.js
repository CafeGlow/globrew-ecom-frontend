/* ==========================================================================
   JAGAVE — E-Commerce Store Frontend
   Cart state, navigation, animations, and view rendering
   ========================================================================== */

(() => {
  'use strict';

  /* ---------- Constants ---------- */
  const STORAGE_KEY = 'jagave.cart.v1';
  const REGION_ID = 'in';
  const CURRENCY = { code: 'INR', symbol: '₹' };
  const FREE_SHIPPING_THRESHOLD = 2300;
  const RUPEE_FORMAT = new Intl.NumberFormat('en-IN');

  /* ---------- Helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const formatPrice = (value) => `${CURRENCY.symbol}${RUPEE_FORMAT.format(value)}`;

  const escapeHtml = (str = '') =>
    String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  /* ---------- useCartStore (vanilla equivalent of Zustand store) ----------
     Mirrors the API described in the issue:
       cart = { items: [], subtotal: 0, total: 0, region_id: 'in' }
       addItem(variantId, quantity)
       removeItem(lineItemId)
       updateQuantity(lineItemId, quantity)
       toggleCartDrawer()
     Also exposed as window.useCartStore for ergonomic global access.
  -------------------------------------------------------------------------- */
  function createCartStore() {
    const subscribers = new Set();
    let state = {
      items: [],
      subtotal: 0,
      total: 0,
      region_id: REGION_ID,
      drawerOpen: false,
    };

    const persist = () => {
      try {
        const persisted = {
          items: state.items,
          region_id: state.region_id,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
      } catch (e) { /* storage unavailable — silent */ }
    };

    const restore = () => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.items)) {
          state.items = data.items.map((it) => ({ ...it }));
          recompute();
        }
      } catch (e) { /* corrupt storage — silent */ }
    };

    const recompute = () => {
      state.subtotal = state.items.reduce(
        (acc, it) => acc + (Number(it.price) || 0) * (Number(it.quantity) || 0),
        0
      );
      state.total = state.subtotal; // shipping/tax computed at checkout (Medusa parity)
      persist();
      notify();
    };

    const notify = () => subscribers.forEach((cb) => cb(state));

    const lineItemId = (variantId) => `li_${variantId}`;

    const addItem = (variantId, quantity = 1) => {
      if (!variantId) return;
      const product = findProductByVariant(variantId);
      if (!product) return;
      const variant = product.variants.find((v) => v.id === variantId);
      if (!variant) return;

      const id = lineItemId(variantId);
      const existing = state.items.find((it) => it.id === id);
      if (existing) {
        existing.quantity += quantity;
      } else {
        state.items.push({
          id,
          variant_id: variantId,
          product_id: product.id,
          handle: product.handle,
          title: product.title,
          variant_title: variant.title,
          flavour: variant.flavour,
          delivery: variant.delivery,
          price: variant.price,
          compare_at_price: variant.compare_at_price,
          subscription: variant.subscription,
          quantity,
          tone: (product.images[0] && product.images[0].tone) || 'cream-deep',
        });
      }
      recompute();
    };

    const removeItem = (id) => {
      const before = state.items.length;
      state.items = state.items.filter((it) => it.id !== id);
      if (state.items.length !== before) recompute();
    };

    const updateQuantity = (id, quantity) => {
      const item = state.items.find((it) => it.id === id);
      if (!item) return;
      const q = Math.max(1, Math.floor(Number(quantity) || 1));
      if (q === item.quantity) return;
      item.quantity = q;
      recompute();
    };

    const toggleCartDrawer = (force) => {
      state.drawerOpen = typeof force === 'boolean' ? force : !state.drawerOpen;
      notify();
    };

    const subscribe = (cb) => {
      subscribers.add(cb);
      cb(state);
      return () => subscribers.delete(cb);
    };

    const getState = () => state;

    restore();

    return {
      getState,
      subscribe,
      addItem,
      removeItem,
      updateQuantity,
      toggleCartDrawer,
      formatPrice,
    };
  }

  /* ---------- Data access ---------- */
  let CATALOG = { products: [], store: {} };
  const findProductByHandle = (handle) => CATALOG.products.find((p) => p.handle === handle);
  const findProductById = (id) => CATALOG.products.find((p) => p.id === id);
  const findProductByVariant = (variantId) =>
    CATALOG.products.find((p) => p.variants.some((v) => v.id === variantId));

  async function loadCatalog() {
    try {
      const res = await fetch('data.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Catalog HTTP ${res.status}`);
      CATALOG = await res.json();
      window.CATALOG = CATALOG;
    } catch (e) {
      console.error('Failed to load catalog', e);
      CATALOG = { products: [], store: { currency: CURRENCY } };
    }
  }

  /* ---------- Dual cursor ---------- */
  function initCursor() {
    if (window.matchMedia('(hover: none)').matches) return;
    const dot = document.createElement('div');
    const ring = document.createElement('div');
    dot.className = 'cursor-dot';
    ring.className = 'cursor-ring';
    document.body.append(dot, ring);

    let mx = window.innerWidth / 2;
    let my = window.innerHeight / 2;
    let rx = mx, ry = my;

    document.addEventListener('mousemove', (e) => {
      mx = e.clientX;
      my = e.clientY;
      dot.style.transform = `translate3d(${mx}px, ${my}px, 0) translate(-50%, -50%)`;
    });

    const tick = () => {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0) translate(-50%, -50%)`;
      requestAnimationFrame(tick);
    };
    tick();

    const setInverted = (inverted) => {
      dot.classList.toggle('is-inverted', inverted);
      ring.classList.toggle('is-inverted', inverted);
    };
    const setHover = (hover) => {
      ring.classList.toggle('is-hover', hover);
    };

    // invert over dark sections
    $$('.bg-espresso, .product-card, .tile--espresso').forEach((el) => {
      el.addEventListener('mouseenter', () => setInverted(true));
      el.addEventListener('mouseleave', () => setInverted(false));
    });

    // grow ring on hoverable elements
    $$('a, button, .product-card, .pdp__thumb, .variant-chip').forEach((el) => {
      el.addEventListener('mouseenter', () => setHover(true));
      el.addEventListener('mouseleave', () => setHover(false));
    });
  }

  /* ---------- Header sticky behaviour ---------- */
  function initHeader() {
    const header = $('.site-header');
    if (!header) return;
    const onScroll = () => header.classList.toggle('is-stuck', window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Mobile drawer ---------- */
  function initMobileDrawer() {
    const toggle = $('.menu-toggle');
    const drawer = $('.mobile-drawer');
    if (!toggle || !drawer) return;
    const close = () => drawer.classList.remove('is-open');
    toggle.addEventListener('click', () => drawer.classList.toggle('is-open'));
    drawer.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  /* ---------- Cart drawer ---------- */
  function initCartDrawer(cart) {
    const backdrop = $('.drawer-backdrop');
    const drawer = $('.drawer');
    const closeBtn = $('.drawer__close');
    if (!backdrop || !drawer) return;

    const open = () => {
      backdrop.classList.add('is-open');
      drawer.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    };
    const close = () => {
      backdrop.classList.remove('is-open');
      drawer.classList.remove('is-open');
      document.body.style.overflow = '';
    };

    cart.subscribe((state) => {
      // Only react to drawer state changes (caller toggles via toggleCartDrawer)
      const isOpen = drawer.classList.contains('is-open');
      if (state.drawerOpen && !isOpen) open();
      if (!state.drawerOpen && isOpen) close();
    });

    backdrop.addEventListener('click', () => cart.toggleCartDrawer(false));
    closeBtn?.addEventListener('click', () => cart.toggleCartDrawer(false));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drawer.classList.contains('is-open')) {
        cart.toggleCartDrawer(false);
      }
    });

    $$('[data-open-cart]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        cart.toggleCartDrawer(true);
      })
    );

    $$('[data-checkout]').forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        showToast('Checkout coming soon — connect Medusa to enable.');
      })
    );
  }

  /* ---------- Cart UI rendering ---------- */
  function renderCart(cart) {
    const itemsEl = $('.drawer__items');
    const emptyEl = $('.drawer__empty');
    const subtotalEl = $('.drawer__subtotal');
    const totalEl = $('.drawer__total');
    const progressEl = $('.progress__fill');
    const progressLabel = $('.progress__label');
    if (!itemsEl) return;

    const { items, subtotal } = cart.getState();

    if (!items.length) {
      itemsEl.innerHTML = '';
      emptyEl && (emptyEl.style.display = 'block');
    } else {
      emptyEl && (emptyEl.style.display = 'none');
      itemsEl.innerHTML = items
        .map((it) => `
          <article class="drawer-item">
            <div class="drawer-item__media tile tile--${escapeHtml(it.tone || 'cream-deep')}">
              <span class="tile__placeholder">${escapeHtml(it.title.slice(0, 2).toUpperCase())}</span>
            </div>
            <div class="drawer-item__body">
              <h4 class="drawer-item__title">${escapeHtml(it.title)}</h4>
              <div class="drawer-item__variant">${escapeHtml(it.delivery || '')}${it.flavour ? ` · ${escapeHtml(it.flavour)}` : ''}</div>
              <div class="drawer-item__row">
                <div class="qty-stepper" data-line="${escapeHtml(it.id)}">
                  <button data-act="dec" aria-label="Decrease quantity">−</button>
                  <span>${it.quantity}</span>
                  <button data-act="inc" aria-label="Increase quantity">+</button>
                </div>
                <span class="drawer-item__price">${cart.formatPrice(it.price * it.quantity)}</span>
              </div>
              <button class="drawer-item__remove" data-remove="${escapeHtml(it.id)}">Remove</button>
            </div>
          </article>
        `)
        .join('');
    }

    if (subtotalEl) subtotalEl.textContent = cart.formatPrice(subtotal);
    if (totalEl) totalEl.textContent = cart.formatPrice(subtotal);

    if (progressEl) {
      const ratio = Math.min(1, subtotal / FREE_SHIPPING_THRESHOLD);
      progressEl.style.width = `${ratio * 100}%`;
      const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - subtotal);
      if (progressLabel) {
        progressLabel.textContent = remaining > 0
          ? `Add ${cart.formatPrice(remaining)} more for Complimentary Express Shipping`
          : 'Complimentary Express Shipping unlocked';
      }
    }

    // wire up steppers + remove
    itemsEl.querySelectorAll('.qty-stepper').forEach((stepper) => {
      const id = stepper.getAttribute('data-line');
      stepper.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const item = cart.getState().items.find((it) => it.id === id);
        if (!item) return;
        const act = btn.getAttribute('data-act');
        const next = act === 'inc' ? item.quantity + 1 : item.quantity - 1;
        if (next < 1) {
          cart.removeItem(id);
        } else {
          cart.updateQuantity(id, next);
        }
      });
    });
    itemsEl.querySelectorAll('[data-remove]').forEach((btn) => {
      btn.addEventListener('click', () => cart.removeItem(btn.getAttribute('data-remove')));
    });
  }

  /* ---------- Bag count ---------- */
  function syncBagCount(cart) {
    const count = cart.getState().items.reduce((acc, it) => acc + it.quantity, 0);
    $$('[data-bag-count]').forEach((el) => {
      el.textContent = String(count);
      el.style.display = count > 0 ? 'inline-flex' : 'none';
    });
  }

  /* ---------- Toast ---------- */
  let toastTimer;
  function showToast(message) {
    let toast = $('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2400);
  }

  /* ---------- Search overlay ---------- */
  function initSearch(cart) {
    const overlay = $('.search-overlay');
    const input = $('.search-overlay__input');
    const results = $('.search-overlay__results');
    if (!overlay) return;
    const open = () => {
      overlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
      setTimeout(() => input?.focus(), 60);
    };
    const close = () => {
      overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    };
    $$('[data-open-search]').forEach((el) => el.addEventListener('click', (e) => { e.preventDefault(); open(); }));
    $('.search-overlay__close')?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('is-open')) close();
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); open(); }
    });

    const renderResults = (q) => {
      if (!results) return;
      const needle = (q || '').trim().toLowerCase();
      if (!needle) { results.innerHTML = ''; return; }
      const matches = CATALOG.products.filter((p) =>
        p.title.toLowerCase().includes(needle) ||
        (p.subtitle || '').toLowerCase().includes(needle) ||
        (p.description || '').toLowerCase().includes(needle)
      );
      results.innerHTML = matches.length
        ? matches.map((p) => `
            <a href="product.html?handle=${encodeURIComponent(p.handle)}" class="search-overlay__result" style="display:flex;justify-content:space-between;align-items:center;padding:14px 0;border-bottom:1px solid var(--line);">
              <span class="serif" style="font-size:24px">${escapeHtml(p.title)}</span>
              <span class="mono">${escapeHtml(cart.formatPrice(p.variants[0].price))} →</span>
            </a>
          `).join('')
        : '<p class="dim">No results yet — try "Arabica" or "Spoon".</p>';
    };

    input?.addEventListener('input', (e) => renderResults(e.target.value));

    $$('.search-overlay__hints a').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (input) { input.value = a.textContent.trim(); renderResults(input.value); }
      })
    );
  }

  /* ---------- Quick add buttons (PLP) ---------- */
  function initQuickAdd(cart) {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-quick-add]');
      if (!btn) return;
      e.preventDefault();
      const variantId = btn.getAttribute('data-quick-add');
      cart.addItem(variantId, 1);
      showToast('Added to bag');
      cart.toggleCartDrawer(true);
    });
  }

  /* ---------- PLP product grid rendering ---------- */
  function renderPLP(cart) {
    const grid = $('[data-plp-grid]');
    if (!grid) return;
    grid.innerHTML = CATALOG.products.map((p) => {
      const v = p.variants[0];
      const hasSale = v.compare_at_price && v.compare_at_price > v.price;
      return `
        <article class="product-card reveal">
          <a class="product-card__media tile tile--${escapeHtml(p.images[0]?.tone || 'cream-deep')}" href="product.html?handle=${encodeURIComponent(p.handle)}">
            ${p.tag ? `<span class="tile__badge">${escapeHtml(p.tag)}</span>` : ''}
            <span class="tile__placeholder is-empty">${escapeHtml(p.title.slice(0, 12))}</span>
          </a>
          <div class="product-card__meta">
            <span class="product-card__tag">${escapeHtml(p.subtitle || '')}</span>
            <a class="product-card__title" href="product.html?handle=${encodeURIComponent(p.handle)}">${escapeHtml(p.title)}</a>
            <div class="dim" style="font-size:13px">${escapeHtml(p.description.split('. ')[0])}.</div>
            <div class="product-card__row">
              <span class="product-card__price">${cart.formatPrice(v.price)}${hasSale ? ` <span class="pdp__compare">${cart.formatPrice(v.compare_at_price)}</span>` : ''}</span>
              <button class="btn-link" data-quick-add="${escapeHtml(v.id)}">Add to bag +</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  /* ---------- PDP rendering ---------- */
  function renderPDP(cart) {
    const root = $('[data-pdp]');
    if (!root) return;
    const params = new URLSearchParams(window.location.search);
    const handle = params.get('handle') || 'arabica-morning-30';
    const product = findProductByHandle(handle) || CATALOG.products[0];
    if (!product) return;

    const variant = product.variants[0];
    const flavours = Array.from(new Set(product.variants.map((v) => v.flavour).filter(Boolean)));
    const deliveryOptions = Array.from(new Set(product.variants.map((v) => v.delivery)));
    let selectedFlavour = variant.flavour || flavours[0] || null;
    let selectedDelivery = variant.delivery;
    let selectedVariant = variant;

    const findVariant = (flavour, delivery) =>
      product.variants.find((v) =>
        (flavour ? v.flavour === flavour : true) && v.delivery === delivery
      ) || product.variants[0];

    const updatePriceUI = () => {
      const hasSale = selectedVariant.compare_at_price && selectedVariant.compare_at_price > selectedVariant.price;
      priceEl.innerHTML = `${cart.formatPrice(selectedVariant.price)}${hasSale ? `<span class="pdp__compare">${cart.formatPrice(selectedVariant.compare_at_price)}</span>` : ''}`;
      ctaEl.textContent = `Add to bag — ${cart.formatPrice(selectedVariant.price)}`;
      subEl.textContent = selectedVariant.subscription
        ? `${selectedVariant.subscription_label} · Skip or cancel any time`
        : 'One-time purchase · Free returns within 14 days';
      skuEl.textContent = `SKU · ${selectedVariant.sku}`;
    };

    root.innerHTML = `
      <div class="pdp__gallery">
        <div class="pdp__hero tile tile--${escapeHtml(product.images[0].tone)}">
          <span class="tile__placeholder is-empty">${escapeHtml(product.title)} · Image 01</span>
        </div>
        <div class="pdp__thumbs">
          ${product.images.map((img, i) => `
            <button class="pdp__thumb ${i === 0 ? 'is-active' : ''} tile tile--${escapeHtml(img.tone)}" data-thumb="${i}" aria-label="View image ${i + 1}">
              <span class="tile__placeholder">${escapeHtml(img.alt)}</span>
            </button>
          `).join('')}
        </div>
      </div>
      <div class="pdp__info">
        <div>
          <span class="eyebrow">Formula No. ${escapeHtml(product.formula_no)} · ${escapeHtml(product.subtitle || '')}</span>
        </div>
        <h1 class="h-section">${escapeHtml(product.title)}</h1>
        <p class="lede">${escapeHtml(product.description)}</p>
        <div class="pdp__price" data-price></div>
        <div class="mono" data-sub></div>
        <div class="mono" data-sku></div>

        ${flavours.length > 1 ? `
          <div class="variant-group">
            <span class="variant-group__label">Flavour · <span data-flavour-name>${escapeHtml(selectedFlavour || '')}</span></span>
            <div class="variant-options" data-flavours>
              ${flavours.map((f) => `
                <button class="variant-chip ${f === selectedFlavour ? 'is-active' : ''}" data-flavour="${escapeHtml(f)}">${escapeHtml(f)}</button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="variant-group">
          <span class="variant-group__label">Quantity · <span data-delivery-name>${escapeHtml(selectedDelivery)}</span></span>
          <div class="variant-options" data-delivery>
            ${deliveryOptions.map((d) => `
              <button class="variant-chip ${d === selectedDelivery ? 'is-active' : ''}" data-delivery-option="${escapeHtml(d)}">
                ${escapeHtml(d)}
                <small>${(() => {
                  const v = product.variants.find((vv) => vv.delivery === d);
                  return v ? cart.formatPrice(v.price) : '';
                })()}</small>
              </button>
            `).join('')}
          </div>
        </div>

        <button class="btn btn-primary" data-add>Add to bag — ${cart.formatPrice(selectedVariant.price)}</button>

        <div class="spec-grid">
          <div><span>Format</span><span>${escapeHtml(product.specs.format)}</span></div>
          <div><span>Base</span><span>${escapeHtml(product.specs.base)}</span></div>
          <div><span>Peptides</span><span>${escapeHtml(product.specs.peptides)}</span></div>
          <div><span>Glutathione</span><span>${escapeHtml(product.specs.glutathione)}</span></div>
        </div>

        <div class="accordion" data-accordion>
          <div class="accordion__item is-open">
            <button class="accordion__head">Full Ingredient Breakdown <span class="accordion__icon">+</span></button>
            <div class="accordion__body">
              <ul class="ingredient-list">
                ${product.ingredients.map((ing) => `
                  <li>
                    <span><strong>${escapeHtml(ing.name)}</strong><br><span class="mono">${escapeHtml(ing.origin)}</span></span>
                    <span class="mono">Dose</span>
                    <span>${escapeHtml(ing.dose)}</span>
                  </li>
                `).join('')}
              </ul>
            </div>
          </div>
          <div class="accordion__item">
            <button class="accordion__head">Preparation Ritual <span class="accordion__icon">+</span></button>
            <div class="accordion__body">
              <ol class="ritual-list">
                ${product.ritual.map((r) => `
                  <li>
                    <span><strong>${escapeHtml(r.title)}.</strong> ${escapeHtml(r.detail)}</span>
                  </li>
                `).join('')}
              </ol>
            </div>
          </div>
          <div class="accordion__item">
            <button class="accordion__head">Shipping & Delivery <span class="accordion__icon">+</span></button>
            <div class="accordion__body">
              <p>${escapeHtml(product.shipping)}</p>
            </div>
          </div>
        </div>
      </div>
    `;

    const priceEl = root.querySelector('[data-price]');
    const ctaEl = root.querySelector('[data-add]');
    const subEl = root.querySelector('[data-sub]');
    const skuEl = root.querySelector('[data-sku]');
    const flavourLabelEl = root.querySelector('[data-flavour-name]');
    const deliveryLabelEl = root.querySelector('[data-delivery-name]');

    updatePriceUI();

    // Gallery thumb switcher
    root.querySelectorAll('[data-thumb]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-thumb'));
        root.querySelectorAll('[data-thumb]').forEach((b) => b.classList.toggle('is-active', b === btn));
        const img = product.images[idx];
        const hero = root.querySelector('.pdp__hero');
        hero.className = `pdp__hero tile tile--${img.tone}`;
        hero.innerHTML = `<span class="tile__placeholder is-empty">${escapeHtml(product.title)} · Image ${String(idx + 1).padStart(2, '0')}</span>`;
      });
    });

    // Variant selection
    const selectVariant = () => {
      selectedVariant = findVariant(selectedFlavour, selectedDelivery);
      if (flavourLabelEl && selectedFlavour) flavourLabelEl.textContent = selectedFlavour;
      deliveryLabelEl.textContent = selectedDelivery;
      root.querySelectorAll('[data-flavour]').forEach((b) =>
        b.classList.toggle('is-active', b.getAttribute('data-flavour') === selectedFlavour)
      );
      root.querySelectorAll('[data-delivery-option]').forEach((b) =>
        b.classList.toggle('is-active', b.getAttribute('data-delivery-option') === selectedDelivery)
      );
      updatePriceUI();
    };

    root.querySelectorAll('[data-flavour]').forEach((b) =>
      b.addEventListener('click', () => { selectedFlavour = b.getAttribute('data-flavour'); selectVariant(); })
    );
    root.querySelectorAll('[data-delivery-option]').forEach((b) =>
      b.addEventListener('click', () => { selectedDelivery = b.getAttribute('data-delivery-option'); selectVariant(); })
    );

    ctaEl.addEventListener('click', () => {
      cart.addItem(selectedVariant.id, 1);
      showToast(`${selectedVariant.title} added to bag`);
      cart.toggleCartDrawer(true);
    });

    // Accordion
    root.querySelectorAll('[data-accordion] .accordion__head').forEach((head) => {
      head.addEventListener('click', () => {
        head.parentElement.classList.toggle('is-open');
      });
    });

    // Related products
    const related = $('[data-related]');
    if (related) {
      const others = CATALOG.products.filter((p) => p.id !== product.id).slice(0, 3);
      related.innerHTML = others.map((p) => {
        const v = p.variants[0];
        return `
          <article class="product-card reveal">
            <a class="product-card__media tile tile--${escapeHtml(p.images[0].tone)}" href="product.html?handle=${encodeURIComponent(p.handle)}">
              <span class="tile__placeholder is-empty">${escapeHtml(p.title.slice(0, 12))}</span>
            </a>
            <div class="product-card__meta">
              <span class="product-card__tag">${escapeHtml(p.subtitle || '')}</span>
              <a class="product-card__title" href="product.html?handle=${encodeURIComponent(p.handle)}">${escapeHtml(p.title)}</a>
              <div class="product-card__row">
                <span class="product-card__price">${cart.formatPrice(v.price)}</span>
                <a class="btn-link" href="product.html?handle=${encodeURIComponent(p.handle)}">View →</a>
              </div>
            </div>
          </article>
        `;
      }).join('');
    }
  }

  /* ---------- Horizontal pinned track ---------- */
  function initTrack() {
    const pin = document.querySelector('[data-track-pin]');
    if (!pin) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    let raf;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const sectionRect = pin.parentElement.getBoundingClientRect();
        const pinRect = pin.getBoundingClientRect();
        const total = pin.scrollWidth - window.innerWidth;
        // Key progress to the pin itself, not the wrapping section:
        // the pin sits below a heading + spacer, so the old math had it
        // already ~12% translated before its top reached the viewport top.
        const pinTopInSection = pinRect.top - sectionRect.top;
        const scrollable = pinRect.height - window.innerHeight;
        const progress = scrollable > 0
          ? Math.max(0, Math.min(1, (-sectionRect.top - pinTopInSection) / scrollable))
          : 0;
        pin.style.transform = `translate3d(${-progress * total}px, 0, 0)`;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /* ---------- Reveal on scroll ---------- */
  function initReveal() {
    const items = $$('.reveal');
    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    items.forEach((el) => io.observe(el));
  }

  /* ---------- Smooth scroll (in-page anchors only) ---------- */
  function initSmoothScroll() {
    // Defer to the browser for the actual scrolling + offset.
    // scroll-padding-top in style.css handles the fixed-header offset for both
    // this handler and cross-page links (e.g. shop.html → index.html#story).
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    $$('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const id = a.getAttribute('href');
        if (!id || id === '#') return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        // Keep the URL hash in sync for sharing / bookmarking without
        // re-triggering the browser's native anchor jump.
        if (window.history && history.replaceState) history.replaceState(null, '', id);
      });
    });
  }

  /* ---------- Hero entrance (staggered fade-in) ---------- */
  function initHeroMotion() {
    const hero = $('.hero');
    if (!hero) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // .reveal items are animated by initReveal via the .is-in CSS transition;
    // we just stagger them with transition-delay. Non-reveal items (e.g.
    // .hero__meta span) need their own WAAPI since they have no transition.
    const targets = $$('.hero .reveal, .hero__meta span', hero);
    targets.forEach((el, i) => {
      if (reduce) { el.classList.add('is-in'); return; }
      if (el.classList.contains('reveal')) {
        el.style.transitionDelay = `${80 * i}ms`;
      } else {
        el.animate(
          [
            { opacity: 0, transform: 'translateY(28px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 900, delay: 80 * i, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'both' }
        );
      }
    });
  }

  /* ---------- Shop preview grid on landing ---------- */
  function renderShopPreview(cart) {
    const grid = $('[data-shop-preview]');
    if (!grid) return;
    const items = CATALOG.products.slice(0, 3);
    grid.innerHTML = items.map((p) => {
      const v = p.variants[0];
      return `
        <article class="product-card reveal">
          <a class="product-card__media tile tile--${escapeHtml(p.images[0].tone)}" href="product.html?handle=${encodeURIComponent(p.handle)}">
            ${p.tag ? `<span class="tile__badge">${escapeHtml(p.tag)}</span>` : ''}
            <span class="tile__placeholder is-empty">${escapeHtml(p.title.slice(0, 12))}</span>
          </a>
          <div class="product-card__meta">
            <span class="product-card__tag">${escapeHtml(p.subtitle || '')}</span>
            <a class="product-card__title" href="product.html?handle=${encodeURIComponent(p.handle)}">${escapeHtml(p.title)}</a>
            <div class="product-card__row">
              <span class="product-card__price">${cart.formatPrice(v.price)}</span>
              <button class="btn-link" data-quick-add="${escapeHtml(v.id)}">Add to bag +</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  /* ---------- Cart store accessor ---------- */
  // Single shared instance available everywhere on the page.
  const cart = createCartStore();
  window.useCartStore = cart;

  /* ---------- Boot ---------- */
  async function boot() {
    await loadCatalog();
    initHeader();
    initMobileDrawer();
    initCartDrawer(cart);
    initSearch(cart);
    initQuickAdd(cart);
    initSmoothScroll();
    initHeroMotion();
    initTrack();

    renderCart(cart);
    cart.subscribe(() => {
      renderCart(cart);
      syncBagCount(cart);
    });
    syncBagCount(cart);

    // Page-specific rendering — these add fresh .reveal nodes that
    // initReveal() must observe, so they have to run first.
    renderShopPreview(cart);
    renderPLP(cart);
    renderPDP(cart);

    // Reveal observer runs last so dynamically rendered cards (PLP grid,
    // shop preview, PDP related) fade in instead of staying at opacity: 0.
    initReveal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
