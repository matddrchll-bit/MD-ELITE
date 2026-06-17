const db = createMdEliteClient();

let PRODUCTS = [];
let OFFERS = [];
let editingProductId = null;
let adminRefreshTimer;

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

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    if (!file.type.startsWith("image/")) {
      reject(new Error("Selecciona un archivo de imagen valido"));
      return;
    }
    // Base64 funciona ahora; para muchas imagenes grandes conviene migrar a Supabase Storage.
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
    reader.readAsDataURL(file);
  });
}

async function productPayload() {
  const currentProduct = editingProductId
    ? PRODUCTS.find(product => product.id === editingProductId)
    : null;
  const fileInput = document.getElementById("f-image-file");
  const selectedFile = fileInput.files && fileInput.files[0];
  const image = selectedFile
    ? await imageFileToDataUrl(selectedFile)
    : currentProduct?.image || "";

  return {
    name: document.getElementById("f-name").value.trim(),
    price: Number(document.getElementById("f-price").value || 0),
    stock: Number(document.getElementById("f-stock").value || 0),
    category: document.getElementById("f-cat").value,
    badge: document.getElementById("f-badge").value || null,
    image_url: image || null,
    description: document.getElementById("f-desc").value.trim(),
    active: document.getElementById("f-active").value === "true"
  };
}

async function login() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-pass").value;
  const errorBox = document.getElementById("login-err");
  errorBox.style.color = "";
  errorBox.textContent = "";

  if (!email || !password) {
    errorBox.textContent = "Completa el correo y la contraseña.";
    return;
  }

  const { error } = await db.auth.signInWithPassword({ email, password });
  if (error) {
    errorBox.textContent = "No se pudo iniciar sesión. Revisa tus datos.";
    return;
  }

  await restoreSession();
}

async function registerAdmin() {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-pass").value;
  const errorBox = document.getElementById("login-err");
  errorBox.style.color = "";
  errorBox.textContent = "";

  if (!email || password.length < 8) {
    errorBox.textContent = "Usa el correo autorizado y una contraseña de al menos 8 caracteres.";
    return;
  }

  const { data, error } = await db.auth.signUp({ email, password });
  if (error) {
    errorBox.textContent = error.message;
    return;
  }

  if (data.session) {
    await restoreSession();
  } else {
    errorBox.style.color = "var(--green)";
    errorBox.textContent = "Revisa tu correo para confirmar la cuenta y luego inicia sesión.";
  }
}

async function isAuthorizedAdmin(user) {
  const { data, error } = await db
    .from("admin_users")
    .select("email")
    .eq("email", user.email)
    .maybeSingle();

  if (error) {
    console.error(error);
    return false;
  }
  return Boolean(data);
}

async function restoreSession() {
  const { data: { session } } = await db.auth.getSession();
  if (!session) {
    showLogin();
    return;
  }

  if (!await isAuthorizedAdmin(session.user)) {
    await db.auth.signOut();
    showLogin("Este correo no tiene permisos de administrador.");
    return;
  }

  showAdmin();
  await loadAdminData();
  subscribeToAdminData();
}

async function logout() {
  await db.auth.signOut();
  location.reload();
}

function showLogin(message = "") {
  document.getElementById("login-view").style.display = "flex";
  document.getElementById("admin-view").classList.remove("on");
  document.getElementById("logout-btn").style.display = "none";
  document.getElementById("login-err").textContent = message;
}

function showAdmin() {
  document.getElementById("login-view").style.display = "none";
  document.getElementById("admin-view").classList.add("on");
  document.getElementById("logout-btn").style.display = "inline-block";
}

async function loadAdminData() {
  const [{ data: products, error: productsError }, { data: offers, error: offersError }] =
    await Promise.all([
      db.from("products").select("*").order("id"),
      db.from("offers").select("*").order("created_at", { ascending: false })
    ]);

  if (productsError) throw productsError;
  if (offersError) throw offersError;

  PRODUCTS = (products || []).map(mapProduct);
  OFFERS = (offers || []).map(mapOffer);
  renderProducts();
  refreshOfferProductOptions();
  renderOffers();
}

function scheduleAdminRefresh() {
  clearTimeout(adminRefreshTimer);
  adminRefreshTimer = setTimeout(() => {
    loadAdminData().catch(handleAdminError);
  }, 180);
}

function subscribeToAdminData() {
  if (window.mdEliteAdminChannel) return;
  window.mdEliteAdminChannel = db.channel("md-elite-admin")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, scheduleAdminRefresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "offers" }, scheduleAdminRefresh)
    .subscribe();
}

function handleAdminError(error) {
  console.error(error);
  showToast(error.message || "Ocurrió un error al conectar con Supabase");
}

function stockClass(stock) {
  return stock <= 0 ? "out" : stock <= 2 ? "low" : "ok";
}

function stockText(stock) {
  return stock <= 0 ? "Agotado" : stock <= 2 ? `Últimas ${stock}` : `Stock: ${stock}`;
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

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(button => {
    button.classList.toggle("on", button.dataset.tab === name);
  });
  document.querySelectorAll('.view[id^="tab-"]').forEach(view => {
    view.classList.toggle("on", view.id === `tab-${name}`);
  });
}

function renderProducts() {
  document.getElementById("prod-count").textContent = PRODUCTS.length;
  const list = document.getElementById("prod-list");
  if (!PRODUCTS.length) {
    list.innerHTML = '<div class="empty">No hay productos todavía.</div>';
    return;
  }

  list.innerHTML = PRODUCTS.map(product => {
    const stockTag = `<span class="tag ${stockClass(product.stock)}">● ${stockText(product.stock)}</span>`;
    const visibilityTag = product.active === false
      ? '<span class="tag hidden">Oculto</span>'
      : '<span class="tag active">Visible</span>';
    const image = safeImageUrl(product.image);
    const visual = image
      ? `<img src="${escapeHtml(image)}" alt="">`
      : noImagePlaceholder();

    return `<div class="row">
      <div class="thumb">${visual}</div>
      <div>
        <strong>${escapeHtml(product.name)}</strong>
        <small>Bs. ${Number(product.price).toLocaleString("es-BO")} · ${escapeHtml(product.cat)}</small>
        <div>${stockTag} ${visibilityTag}</div>
      </div>
      <div class="rowbtns">
        <button class="btn-link" onclick="editProduct(${product.id})">Editar</button>
        <button class="btn-link" style="background:rgba(255,107,53,.12);color:var(--orange)" onclick="toggleAgotado(${product.id})">${product.stock <= 0 ? "Marcar disponible" : "Marcar agotado"}</button>
        <button class="btn-link" style="background:rgba(255,59,92,.12);color:#ff8aa0" onclick="deleteProduct(${product.id})">Borrar</button>
      </div>
    </div>`;
  }).join("");
}

function resetProductForm() {
  editingProductId = null;
  document.getElementById("prod-form-title").textContent = "Nuevo producto";
  ["name", "price", "stock", "desc"].forEach(key => {
    document.getElementById(`f-${key}`).value = "";
  });
  document.getElementById("f-image-file").value = "";
  document.getElementById("f-cat").value = "teclados";
  document.getElementById("f-badge").value = "";
  document.getElementById("f-active").value = "true";
}

function editProduct(id) {
  const product = PRODUCTS.find(item => item.id === id);
  if (!product) return;

  editingProductId = id;
  document.getElementById("prod-form-title").textContent = "Editar producto";
  document.getElementById("f-name").value = product.name || "";
  document.getElementById("f-price").value = product.price ?? "";
  document.getElementById("f-stock").value = product.stock ?? "";
  document.getElementById("f-cat").value = product.cat || "teclados";
  document.getElementById("f-badge").value = product.badge || "";
  document.getElementById("f-image-file").value = "";
  document.getElementById("f-desc").value = product.desc || "";
  document.getElementById("f-active").value = String(product.active !== false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveProduct() {
  let payload;
  try {
    payload = await productPayload();
  } catch (error) {
    showToast(error.message || "No se pudo leer la imagen");
    return;
  }
  if (!payload.name) {
    showToast("Falta el nombre del producto");
    return;
  }
  if (payload.price < 0 || payload.stock < 0) {
    showToast("Precio y stock deben ser positivos");
    return;
  }

  const query = editingProductId
    ? db.from("products").update(payload).eq("id", editingProductId)
    : db.from("products").insert(payload);
  const { error } = await query;
  if (error) {
    handleAdminError(error);
    return;
  }

  resetProductForm();
  await loadAdminData();
  showToast("Producto guardado");
}

async function toggleAgotado(id) {
  const product = PRODUCTS.find(item => item.id === id);
  if (!product) return;

  const stock = product.stock > 0 ? 0 : 1;
  const { error } = await db.from("products").update({ stock }).eq("id", id);
  if (error) {
    handleAdminError(error);
    return;
  }
  await loadAdminData();
  showToast(stock <= 0 ? "Producto marcado como agotado" : "Producto disponible");
}

async function deleteProduct(id) {
  if (!confirm("¿Borrar este producto? También se eliminarán sus ofertas.")) return;
  const { error } = await db.from("products").delete().eq("id", id);
  if (error) {
    handleAdminError(error);
    return;
  }
  await loadAdminData();
  showToast("Producto borrado");
}

function refreshOfferProductOptions() {
  const select = document.getElementById("o-product");
  const previous = select.value;
  select.innerHTML = PRODUCTS.map(product =>
    `<option value="${product.id}">${escapeHtml(product.name)} (Bs. ${Number(product.price).toLocaleString("es-BO")})</option>`
  ).join("");
  if (previous && PRODUCTS.some(product => String(product.id) === String(previous))) {
    select.value = previous;
  }
  onOfferProductChange();
}

function onOfferProductChange() {
  const id = document.getElementById("o-product").value;
  const product = PRODUCTS.find(item => String(item.id) === String(id));
  if (product && !document.getElementById("o-old").value) {
    document.getElementById("o-old").value = product.price;
  }
}

function recalcFromOld() {
  recalcDiscount();
}

function recalcFromNew() {
  recalcDiscount();
}

function recalcFromDiscount() {
  const oldPrice = Number(document.getElementById("o-old").value || 0);
  const discount = Number(document.getElementById("o-discount").value || 0);
  if (oldPrice > 0 && discount >= 0) {
    document.getElementById("o-new").value = (oldPrice * (1 - discount / 100)).toFixed(2);
  }
}

function recalcDiscount() {
  const oldPrice = Number(document.getElementById("o-old").value || 0);
  const newPrice = Number(document.getElementById("o-new").value || 0);
  if (oldPrice > 0 && newPrice >= 0) {
    const discount = Math.round((1 - newPrice / oldPrice) * 100);
    document.getElementById("o-discount").value = Number.isFinite(discount) ? discount : "";
  }
}

function renderOffers() {
  document.getElementById("offer-count").textContent = OFFERS.length;
  const list = document.getElementById("offer-list");
  if (!OFFERS.length) {
    list.innerHTML = '<div class="empty">No hay ofertas creadas.</div>';
    return;
  }

  list.innerHTML = OFFERS.map(offer => {
    const product = PRODUCTS.find(item => String(item.id) === String(offer.productId));
    const name = product ? product.name : "(producto eliminado)";
    const status = isOfferActive(offer)
      ? '<span class="tag active">Activa</span>'
      : '<span class="tag hidden">Inactiva</span>';
    const range = offer.startDate || offer.endDate
      ? `${offer.startDate || "sin inicio"} → ${offer.endDate || "sin fin"}`
      : "Siempre activa";
    const image = product ? safeImageUrl(product.image) : "";
    const visual = image
      ? `<img src="${escapeHtml(image)}" alt="">`
      : noImagePlaceholder();

    return `<div class="row">
      <div class="thumb">${visual}</div>
      <div>
        <strong>${escapeHtml(name)}</strong>
        <small>Bs. ${Number(offer.oldPrice).toLocaleString("es-BO")} → Bs. ${Number(offer.offerPrice).toLocaleString("es-BO")} (-${offer.discountPercent}%)</small>
        <div><span class="discount-pill">${escapeHtml(range)}</span> ${status}</div>
      </div>
      <div class="rowbtns">
        <button class="btn-link" style="background:rgba(255,59,92,.12);color:#ff8aa0" onclick="deleteOffer('${offer.id}')">Borrar</button>
      </div>
    </div>`;
  }).join("");
}

async function saveOffer() {
  const productId = Number(document.getElementById("o-product").value);
  const oldPrice = Number(document.getElementById("o-old").value || 0);
  const offerPrice = Number(document.getElementById("o-new").value || 0);
  const discountPercent = Number(
    document.getElementById("o-discount").value ||
    Math.round((1 - offerPrice / oldPrice) * 100) ||
    0
  );
  const startDate = document.getElementById("o-start").value || null;
  const endDate = document.getElementById("o-end").value || null;

  if (!productId) {
    showToast("Selecciona un producto");
    return;
  }
  if (!oldPrice || !offerPrice || offerPrice >= oldPrice) {
    showToast("El precio de oferta debe ser menor al anterior");
    return;
  }
  if (startDate && endDate && startDate > endDate) {
    showToast("La fecha de inicio no puede ser posterior al fin");
    return;
  }

  const { error } = await db.from("offers").insert({
    product_id: productId,
    old_price: oldPrice,
    offer_price: offerPrice,
    discount_percent: discountPercent,
    start_date: startDate,
    end_date: endDate
  });
  if (error) {
    handleAdminError(error);
    return;
  }

  ["old", "new", "discount", "start", "end"].forEach(key => {
    document.getElementById(`o-${key}`).value = "";
  });
  await loadAdminData();
  showToast("Oferta creada y publicada");
}

async function deleteOffer(id) {
  if (!confirm("¿Borrar esta oferta?")) return;
  const { error } = await db.from("offers").delete().eq("id", id);
  if (error) {
    handleAdminError(error);
    return;
  }
  await loadAdminData();
  showToast("Oferta borrada");
}

let toastTimer;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("on"), 2300);
}

db.auth.onAuthStateChange(event => {
  if (event === "SIGNED_OUT") showLogin();
});

restoreSession().catch(handleAdminError);
