const WA = "59172810558";
const ORDERS_KEY = "md_elite_orders_v1";
const db = createMdEliteClient();

let PRODUCTS = [];
let OFFERS = [];
let cart = {};
let catalogRefreshTimer;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function safeImageUrl(value = "") {
  if (String(value).startsWith("data:image/")) return value;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function noImagePlaceholder() {
  return '<span class="no-image">Sin imagen</span>';
}

function mapProduct(row) {
  return {
    id: Number(row.id),
    cat: row.category,
    name: row.name,
    desc: row.description || "",
    price: Number(row.price),
    stock: Number(row.stock),
    badge: row.badge || "",
    image: row.image_url || "",
    active: row.active
  };
}

function mapOffer(row) {
  return {
    id: row.id,
    productId: Number(row.product_id),
    oldPrice: Number(row.old_price),
    offerPrice: Number(row.offer_price),
    discountPercent: Number(row.discount_percent),
    startDate: row.start_date || "",
    endDate: row.end_date || ""
  };
}

async function loadCatalog() {
  const [{ data: products, error: productsError }, { data: offers, error: offersError }] =
    await Promise.all([
      db.from("products").select("*").eq("active", true).order("id"),
      db.from("offers").select("*").order("created_at", { ascending: false })
    ]);

  if (productsError) throw productsError;
  if (offersError) throw offersError;

  PRODUCTS = (products || []).map(mapProduct);
  OFFERS = (offers || []).map(mapOffer);
  syncCartWithCatalog();
  renderProducts(currentFilter());
  renderOffers();
  refreshCart();
}

function scheduleCatalogRefresh() {
  clearTimeout(catalogRefreshTimer);
  catalogRefreshTimer = setTimeout(() => {
    loadCatalog().catch(handleCatalogError);
  }, 180);
}

function subscribeToCatalog() {
  db.channel("md-elite-storefront")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, scheduleCatalogRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "offers" }, scheduleCatalogRefresh)
    .subscribe();
}

function handleCatalogError(error) {
  console.error(error);
  document.getElementById("pgrid").innerHTML =
    '<p style="color:var(--red);text-align:center;grid-column:1/-1">No se pudo cargar el catalogo. Intenta nuevamente en unos segundos.</p>';
  showToast("No se pudo conectar con la tienda");
}

function currentFilter() {
  return document.querySelector(".fbtn.on")?.dataset.cat || "todos";
}

function stockClass(stock) {
  return stock <= 0 ? "out" : stock <= 2 ? "low" : "ok";
}

function stockText(stock) {
  return stock <= 0 ? "Agotado" : stock <= 2 ? `Ultimas ${stock}` : `Stock: ${stock}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isOfferActive(offer) {
  const today = todayStr();
  if (offer.startDate && today < offer.startDate) return false;
  if (offer.endDate && today > offer.endDate) return false;
  return true;
}

function activeOfferFor(productId) {
  return OFFERS.find(offer =>
    String(offer.productId) === String(productId) && isOfferActive(offer)
  ) || null;
}

function effectivePrice(product) {
  const offer = activeOfferFor(product.id);
  return offer ? Number(offer.offerPrice) : Number(product.price);
}

function syncCartWithCatalog() {
  Object.keys(cart).forEach(key => {
    const product = PRODUCTS.find(item => String(item.id) === String(key));
    if (!product || product.active === false) {
      delete cart[key];
      return;
    }

    cart[key].p = { ...product, price: effectivePrice(product) };
    cart[key].qty = Math.min(cart[key].qty, product.stock);
    if (cart[key].qty <= 0) delete cart[key];
  });
}

function addToCart(id) {
  const product = PRODUCTS.find(item => item.id === id && item.active !== false);
  if (!product) return;

  const quantity = cart[id]?.qty || 0;
  if (product.stock <= 0) {
    showToast("Producto agotado");
    return;
  }
  if (quantity >= product.stock) {
    showToast("No hay mas stock disponible");
    return;
  }

  const price = effectivePrice(product);
  cart[id] ? cart[id].qty++ : (cart[id] = { p: { ...product, price }, qty: 1 });
  refreshCart();
  showToast(`${product.name} agregado`);
}

function chgQty(key, delta) {
  if (!cart[key]) return;
  const product = PRODUCTS.find(item => String(item.id) === String(key));
  if (delta > 0 && product && cart[key].qty >= product.stock) {
    showToast("No hay mas stock");
    return;
  }
  cart[key].qty += delta;
  if (cart[key].qty <= 0) delete cart[key];
  refreshCart();
}

function rmItem(key) {
  delete cart[key];
  refreshCart();
}

function clearCart() {
  if (!Object.keys(cart).length) return;
  if (confirm("Vaciar carrito?")) {
    cart = {};
    refreshCart();
  }
}

function total() {
  return Object.values(cart).reduce((sum, item) => sum + item.p.price * item.qty, 0);
}

function count() {
  return Object.values(cart).reduce((sum, item) => sum + item.qty, 0);
}

function refreshCart() {
  document.getElementById("cart-count").textContent = count();
  document.getElementById("ctval").innerHTML =
    `${total().toLocaleString("es-BO")}<small> Bs.</small>`;

  const list = document.getElementById("clist");
  const keys = Object.keys(cart);
  if (!keys.length) {
    list.innerHTML = '<div class="cempty"><div class="cempty-icon">&#128722;</div><p>Tu carrito esta vacio</p><small style="color:var(--gray);font-size:.8rem">Agrega productos desde el catalogo</small></div>';
    return;
  }

  list.innerHTML = keys.map(key => {
    const { p, qty } = cart[key];
    const image = safeImageUrl(p.image);
    const visual = image
      ? `<img src="${escapeHtml(image)}" alt="">`
      : noImagePlaceholder();
    return `<div class="citem">
      <div class="cthumb">${visual}</div>
      <div class="cdets">
        <div class="cname">${escapeHtml(p.name)}</div>
        <div class="csubt">Bs. ${(p.price * qty).toLocaleString("es-BO")}</div>
        <div class="cqty">
          <button class="qbtn" onclick="chgQty('${key}',-1)">-</button>
          <span class="qnum">${qty}</span>
          <button class="qbtn" onclick="chgQty('${key}',1)">+</button>
        </div>
      </div>
      <button class="cdel" onclick="rmItem('${key}')">Eliminar</button>
    </div>`;
  }).join("");
}

function sendOrder() {
  const keys = Object.keys(cart);
  if (!keys.length) {
    showToast("Carrito vacio");
    return;
  }

  let message = "*MD ELITE - Pedido*\n\n";
  keys.forEach(key => {
    const { p, qty } = cart[key];
    message += `- ${p.name} x ${qty} = Bs. ${(p.price * qty).toLocaleString("es-BO")}\n`;
  });
  message += `\n*TOTAL: Bs. ${total().toLocaleString("es-BO")}*\n\nHola, quiero confirmar disponibilidad y forma de pago.`;

  const order = {
    date: new Date().toLocaleString("es-BO"),
    items: Object.values(cart).map(item => ({
      name: item.p.name,
      qty: item.qty,
      price: item.p.price
    })),
    total: total(),
    status: "pendiente"
  };
  const orders = JSON.parse(localStorage.getItem(ORDERS_KEY) || "[]");
  orders.unshift(order);
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders));
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(message)}`, "_blank");
}

function sendContactWA() {
  const name = document.getElementById("contact-name").value.trim();
  const phone = document.getElementById("contact-phone").value.trim();
  const email = document.getElementById("contact-email").value.trim();
  const subject = document.getElementById("contact-subject").value.trim();
  const contactMessage = document.getElementById("contact-message").value.trim();
  const missing = [];
  if (!name) missing.push("nombre");
  if (!phone) missing.push("celular");
  if (!contactMessage) missing.push("mensaje");
  if (missing.length) {
    showToast("Falta completar: " + missing.join(", "));
    return;
  }

  const message = `Hola, me comunico desde la web de MD Elite.

Nombre: ${name}
Celular: ${phone}
Email: ${email}
Asunto: ${subject}

Mensaje:
${contactMessage}`;
  window.open(`https://wa.me/${WA}?text=${encodeURIComponent(message)}`, "_blank");
}

function renderProducts(filter = "todos") {
  const list = (filter === "todos"
    ? PRODUCTS
    : PRODUCTS.filter(product => product.cat === filter)
  ).filter(product => product.active !== false);

  document.getElementById("pgrid").innerHTML = list.map((product, index) => {
    const offer = activeOfferFor(product.id);
    const price = offer ? Number(offer.offerPrice) : Number(product.price);
    const priceHtml = offer
      ? `<div class="pprice"><small>Bs.</small>${price.toLocaleString("es-BO")} <span style="font-size:.7rem;color:var(--gray);text-decoration:line-through;-webkit-text-fill-color:var(--gray)">Bs. ${Number(product.price).toLocaleString("es-BO")}</span></div>`
      : `<div class="pprice"><small>Bs.</small>${price.toLocaleString("es-BO")}</div>`;
    const badge = offer
      ? '<span class="pbadge hot">OFERTA</span>'
      : product.badge
        ? `<span class="pbadge ${escapeHtml(product.badge)}">${product.badge === "new" ? "NUEVO" : "HOT"}</span>`
        : "";
    const image = safeImageUrl(product.image);
    const visual = image
      ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" style="position:relative;z-index:1;width:82%;height:82%;object-fit:contain;filter:drop-shadow(0 0 22px rgba(108,71,255,.45))">`
      : noImagePlaceholder();

    return `<div class="pcard ${product.stock <= 0 ? "out" : ""}" style="animation-delay:${index * .04}s">
      <div class="pcard-bracket"></div>
      <div class="pimg">${visual}${badge}</div>
      <div class="pinfo">
        <div class="pcat">${escapeHtml(product.cat)}</div>
        <div class="pname">${escapeHtml(product.name)}</div>
        <div class="pdesc">${escapeHtml(product.desc)}</div>
        <span class="stock-pill ${stockClass(product.stock)}">● ${stockText(product.stock)}</span>
        <div class="pfoot">${priceHtml}<button class="padd" ${product.stock <= 0 ? "disabled" : ""} onclick="addToCart(${product.id})">${product.stock <= 0 ? "Agotado" : "+ Agregar"}</button></div>
      </div>
    </div>`;
  }).join("") || '<p style="color:var(--gray2);text-align:center;grid-column:1/-1">No hay productos en esta categoria.</p>';
}

function renderOffers() {
  const grid = document.getElementById("ogrid");
  if (!grid) return;

  const active = OFFERS.filter(isOfferActive).map(offer => {
    const product = PRODUCTS.find(item => String(item.id) === String(offer.productId));
    return product ? { ...offer, product } : null;
  }).filter(Boolean);

  if (!active.length) {
    grid.innerHTML = '<div class="ocard"><div class="otag">Proximamente</div><div class="oname">Aun no hay ofertas activas</div><div class="odesc">Pronto publicaremos descuentos especiales.</div></div>';
    return;
  }

  grid.innerHTML = active.map(offer => {
    const product = offer.product;
    const oldPrice = Number(offer.oldPrice || product.price);
    const newPrice = Number(offer.offerPrice);
    const discount = Number.isFinite(offer.discountPercent)
      ? Math.round(offer.discountPercent)
      : Math.round(100 - (newPrice / oldPrice * 100));

    return `<div class="ocard">
      <div class="odiscount">-${discount}%</div>
      <div class="otag">${escapeHtml(product.cat)}</div>
      <div class="oname">${escapeHtml(product.name)}</div>
      <div class="odesc">${escapeHtml(product.desc)}</div>
      <div class="oprices">
        <span class="oold">Bs. ${oldPrice.toLocaleString("es-BO")}</span>
        <span class="onew">${newPrice.toLocaleString("es-BO")} <small>Bs.</small></span>
      </div>
      <button class="btn-v" ${product.stock <= 0 ? "disabled" : ""} onclick="addToCart(${product.id})">${product.stock <= 0 ? "Agotado" : "+ Agregar al carrito"}</button>
    </div>`;
  }).join("");
}

window.addEventListener("scroll", () => {
  document.getElementById("nav").classList.toggle("scrolled", window.scrollY > 10);
});

document.getElementById("filter-bar").addEventListener("click", event => {
  const button = event.target.closest(".fbtn");
  if (!button) return;
  document.querySelectorAll(".fbtn").forEach(item => item.classList.remove("on"));
  button.classList.add("on");
  renderProducts(button.dataset.cat);
});

const overlay = document.getElementById("overlay");
const drawer = document.getElementById("cdrawer");
function openCart() {
  drawer.classList.add("on");
  overlay.classList.add("on");
  document.body.style.overflow = "hidden";
}
function closeCart() {
  drawer.classList.remove("on");
  overlay.classList.remove("on");
  document.body.style.overflow = "";
}
document.getElementById("cart-btn").addEventListener("click", openCart);
document.getElementById("cclose").addEventListener("click", closeCart);
overlay.addEventListener("click", closeCart);

const hbg = document.getElementById("hbg");
const mob = document.getElementById("mob-drawer");
hbg.addEventListener("click", () => {
  hbg.classList.toggle("open");
  mob.classList.toggle("open");
  document.body.style.overflow = mob.classList.contains("open") ? "hidden" : "";
});
function closeMob() {
  hbg.classList.remove("open");
  mob.classList.remove("open");
  document.body.style.overflow = "";
}

let toastTimer;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("on"), 2300);
}

document.getElementById("pgrid").innerHTML =
  '<p style="color:var(--gray2);text-align:center;grid-column:1/-1">Cargando catalogo...</p>';
refreshCart();
loadCatalog().then(subscribeToCatalog).catch(handleCatalogError);
