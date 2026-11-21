// BLACK LINE storefront - catalog is fetched from D1 through /api/products.
const AFFILIATE_STORAGE_KEY = "blw_affiliate_code";
let products = [];
let cart = [];

const money = n => `${Number(n || 0).toLocaleString("en-US")} جنيه`;
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[ch]));
function parseArray(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function captureAffiliateCode() {
  try {
    const code = (new URLSearchParams(window.location.search).get("ref") || "").trim().toUpperCase();
    if (/^BL[A-F0-9]{12}$/.test(code)) localStorage.setItem(AFFILIATE_STORAGE_KEY, code);
  } catch (error) { console.error("Affiliate tracking error", error); }
}
function getAffiliateCode() {
  try { return localStorage.getItem(AFFILIATE_STORAGE_KEY) || ""; }
  catch { return ""; }
}
captureAffiliateCode();

function getProduct(id) { return products.find(p => Number(p.id) === Number(id)); }
function renderProducts() {
  for (const category of ["men", "women"]) {
    const box = document.getElementById(category + "Products");
    if (!box) continue;
    const group = products.filter(p => String(p.category || "").toLowerCase() === category);
    if (!group.length) {
      box.innerHTML = '<p class="empty">لا توجد منتجات متاحة في هذا القسم حاليًا.</p>';
      continue;
    }
    box.innerHTML = group.map(p => {
      const sizes = parseArray(p.sizes);
      const colors = parseArray(p.colors);
      const images = parseArray(p.images);
      const image = p.main_image || images[0] || "";
      const sizeOptions = sizes.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
      const colorOptions = colors.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
      const art = image
        ? `<img class="product-image" src="${escapeHtml(image)}" alt="${escapeHtml(p.name)}" loading="lazy">`
        : `<div class="product-art">${escapeHtml(p.name)}</div>`;
      return `<article class="product">
        ${art}
        <h3>${escapeHtml(p.name)}</h3>
        ${p.description ? `<p>${escapeHtml(p.description)}</p>` : ""}
        <label for="size-${p.id}">المقاس</label>
        <select id="size-${p.id}" ${sizes.length ? "" : "disabled"}>
          <option value="">${sizes.length ? "اختر المقاس" : "لا توجد مقاسات"}</option>${sizeOptions}
        </select>
        <label for="color-${p.id}">اللون</label>
        <select id="color-${p.id}" ${colors.length ? "" : "disabled"}>
          <option value="">${colors.length ? "اختر اللون" : "لا توجد ألوان"}</option>${colorOptions}
        </select>
        <div class="product-foot"><strong>${money(p.price)}</strong>
          <button onclick="addToCart(${Number(p.id)})" ${(!sizes.length || !colors.length) ? "disabled" : ""}>أضف للسلة +</button>
        </div>
      </article>`;
    }).join("");
  }
}
async function loadProducts() {
  for (const category of ["men", "women"]) {
    const box = document.getElementById(category + "Products");
    if (box) box.innerHTML = '<p class="empty">جاري تحميل المنتجات...</p>';
  }
  try {
    const response = await fetch("/api/products", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "تعذر تحميل المنتجات");
    products = (result.products || []).map(p => ({
      ...p,
      id: Number(p.id),
      price: Number(p.price),
      sizes: parseArray(p.sizes),
      colors: parseArray(p.colors),
      images: parseArray(p.images)
    })).filter(p => Number.isFinite(p.id) && p.price > 0);
    renderProducts();
    renderCart();
  } catch (error) {
    for (const category of ["men", "women"]) {
      const box = document.getElementById(category + "Products");
      if (box) box.innerHTML = `<p class="empty">${escapeHtml(error.message)}. حاول تحديث الصفحة.</p>`;
    }
  }
}
function addToCart(id) {
  const product = getProduct(id);
  if (!product) { alert("المنتج غير متاح"); return; }
  const size = document.getElementById(`size-${id}`)?.value || "";
  const color = document.getElementById(`color-${id}`)?.value || "";
  if (!product.sizes.includes(size) || !product.colors.includes(color)) {
    alert("من فضلك اختر مقاس ولون متاحين أولًا"); return;
  }
  const existing = cart.find(x => x.id === id && x.size === size && x.color === color);
  if (existing) existing.qty++;
  else cart.push({ id, qty: 1, size, color });
  renderCart();
}
function removeFromCart(index) { cart.splice(index, 1); renderCart(); }
function cartSubtotal() {
  return cart.reduce((sum, item) => sum + (getProduct(item.id)?.price || 0) * item.qty, 0);
}
function renderCart() {
  const countBox = document.getElementById("cartCount");
  const totalBox = document.getElementById("cartTotal");
  const itemsBox = document.getElementById("cartItems");
  if (countBox) countBox.textContent = cart.reduce((sum, item) => sum + item.qty, 0);
  if (totalBox) totalBox.textContent = money(cartSubtotal());
  if (!itemsBox) return;
  itemsBox.innerHTML = cart.length ? cart.map((item, index) => {
    const product = getProduct(item.id);
    if (!product) return "";
    return `<div class="cart-line"><div>${escapeHtml(product.name)}<br><small>المقاس: ${escapeHtml(item.size)}<br>اللون: ${escapeHtml(item.color)}<br>${item.qty} × ${money(product.price)}</small></div><button onclick="removeFromCart(${index})">حذف</button></div>`;
  }).join("") : '<p class="empty">السلة فارغة حاليًا.</p>';
}
const panel = document.getElementById("cartPanel");
const overlay = document.getElementById("overlay");
function openCart() { panel?.classList.add("open"); overlay?.classList.add("open"); }
function closeCart() { panel?.classList.remove("open"); overlay?.classList.remove("open"); }
document.getElementById("openCart")?.addEventListener("click", openCart);
document.getElementById("closeCart")?.addEventListener("click", closeCart);
overlay?.addEventListener("click", closeCart);
const dialog = document.getElementById("orderDialog");
document.getElementById("checkout")?.addEventListener("click", () => {
  if (!cart.length) { alert("السلة فارغة"); return; }
  closeCart(); dialog?.showModal();
});
document.getElementById("closeDialog")?.addEventListener("click", () => dialog?.close());
document.getElementById("orderForm")?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!cart.length) { alert("السلة فارغة"); return; }
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true; button.textContent = "جارٍ إرسال الطلب...";
  try {
    const formData = Object.fromEntries(new FormData(form).entries());
    const response = await fetch("/api/orders", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...formData, affiliateCode: getAffiliateCode(), items: cart.map(item => ({ id: item.id, qty: item.qty, size: item.size, color: item.color })) })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.details ? `${result.error} — ${result.details}` : result.error || "تعذر إرسال الطلب");
    alert("تم تسجيل طلبك بنجاح. رقم الطلب: " + result.orderId);
    cart = []; renderCart(); form.reset(); dialog.close();
  } catch (error) { alert(error.message || "حدث خطأ أثناء إرسال الطلب"); }
  finally { button.disabled = false; button.textContent = "تأكيد الطلب"; }
});
loadProducts();
