
const products = [
  { id: 1, name: "تيشيرت رياضي أسود", category: "men", price: 450, mark: "BLW" },
  { id: 2, name: "هودي كاجوال", category: "men", price: 850, mark: "HOOD" },
  { id: 3, name: "بنطلون رياضي", category: "men", price: 620, mark: "MOVE" },
  { id: 4, name: "طقم رياضي حريمي", category: "women", price: 790, mark: "BLW" },
  { id: 5, name: "تيشيرت أوفر سايز", category: "women", price: 420, mark: "LINE" },
  { id: 6, name: "ليجن رياضي", category: "women", price: 550, mark: "FIT" }
];

const sizes = ["S", "M", "L", "XL", "XXL"];

const colors = [
  { value: "أسود", label: "أسود" },
  { value: "أبيض", label: "أبيض" },
  { value: "رمادي", label: "رمادي" },
  { value: "زيتي", label: "زيتي" },
  { value: "بيرجندي", label: "بيرجندي" }
];

let cart = [];

const money = n => `${n.toLocaleString("en-US")} جنيه`;

function renderProducts() {
  for (const category of ["men", "women"]) {
    document.getElementById(category + "Products").innerHTML =
      products
        .filter(p => p.category === category)
        .map(p => `
          <article class="product">
            <div class="product-art">${p.mark}</div>
            <h3>${p.name}</h3>
            <p>قطعة تجريبية — استبدلها بمنتجك الحقيقي</p>

            <label for="size-${p.id}">المقاس</label>
            <select id="size-${p.id}">
              <option value="">اختر المقاس</option>
              ${sizes.map(s => `<option value="${s}">${s}</option>`).join("")}
            </select>

            <label for="color-${p.id}">اللون</label>
            <select id="color-${p.id}">
              <option value="">اختر اللون</option>
              ${colors.map(c => `<option value="${c.value}">${c.label}</option>`).join("")}
            </select>

            <div class="product-foot">
              <strong>${money(p.price)}</strong>
              <button onclick="addToCart(${p.id})">أضف للسلة +</button>
            </div>
          </article>
        `).join("");
  }
}

function addToCart(id) {
  const size = document.getElementById(`size-${id}`).value;
  const color = document.getElementById(`color-${id}`).value;

  if (!size || !color) {
    alert("من فضلك اختر المقاس واللون أولاً");
    return;
  }

  const item = cart.find(x =>
    x.id === id && x.size === size && x.color === color
  );

  if (item) {
    item.qty++;
  } else {
    cart.push({ id, qty: 1, size, color });
  }

  renderCart();
}

function removeFromCart(index) {
  cart.splice(index, 1);
  renderCart();
}

function renderCart() {
  document.getElementById("cartCount").textContent =
    cart.reduce((s, x) => s + x.qty, 0);

  document.getElementById("cartTotal").textContent =
    money(cart.reduce((s, x) =>
      s + products.find(p => p.id === x.id).price * x.qty, 0
    ));

  document.getElementById("cartItems").innerHTML = cart.length
    ? cart.map((x, index) => {
        const p = products.find(p => p.id === x.id);

        return `
          <div class="cart-line">
            <div>
              ${p.name}<br>
              <small>
                المقاس: ${x.size}<br>
                اللون: ${x.color}<br>
                ${x.qty} × ${money(p.price)}
              </small>
            </div>
            <button onclick="removeFromCart(${index})">حذف</button>
          </div>
        `;
      }).join("")
    : '<p class="empty">السلة فارغة حاليًا.</p>';
}

const panel = document.getElementById("cartPanel");
const overlay = document.getElementById("overlay");

function openCart() {
  panel.classList.add("open");
  overlay.classList.add("open");
}

function closeCart() {
  panel.classList.remove("open");
  overlay.classList.remove("open");
}

document.getElementById("openCart").onclick = openCart;
document.getElementById("closeCart").onclick = closeCart;
overlay.onclick = closeCart;

const dialog = document.getElementById("orderDialog");

document.getElementById("checkout").onclick = () => {
  if (!cart.length) {
    alert("السلة فارغة");
    return;
  }

  closeCart();
  dialog.showModal();
};

document.getElementById("closeDialog").onclick = () => dialog.close();

document.getElementById("orderForm").addEventListener("submit", async e => {
  e.preventDefault();

  if (!cart.length) {
    alert("السلة فارغة");
    return;
  }

  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');

  btn.disabled = true;
  btn.textContent = "جارٍ إرسال الطلب...";

  try {
    const data = Object.fromEntries(
      new FormData(form).entries()
    );

    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...data,
        items: cart.map(x => ({
          id: x.id,
          qty: x.qty,
          size: x.size,
          color: x.color
        }))
      })
    });

    const result = await response.json();

   if (!response.ok) {
  throw new Error(
    result.details
      ? result.error + " — " + result.details
      : result.error || "تعذر إرسال الطلب"
  );
}

    alert(
      "تم تسجيل طلبك بنجاح. رقم الطلب: " + result.orderId
    );

    cart = [];
    renderCart();
    form.reset();
    dialog.close();

  } catch (err) {
    alert(err.message || "حدث خطأ أثناء إرسال الطلب");

  } finally {
    btn.disabled = false;
    btn.textContent = "تأكيد الطلب";
  }
});

renderProducts();
renderCart();
