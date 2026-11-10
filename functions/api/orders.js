
const PRODUCTS = {
  1: { name: "تيشيرت رياضي أسود", price: 450 },
  2: { name: "هودي كاجوال", price: 850 },
  3: { name: "بنطلون رياضي", price: 620 },
  4: { name: "طقم رياضي حريمي", price: 790 },
  5: { name: "تيشيرت أوفر سايز", price: 420 },
  6: { name: "ليجن رياضي", price: 550 }
};

const SIZES = ["S", "M", "L", "XL", "XXL"];
const COLORS = ["أسود", "أبيض", "رمادي", "زيتي", "بيرجندي"];

export async function onRequestPost({ request, env }) {
  try {
    const db = env["blackline-wear-orders"];

    if (!db) {
      return Response.json(
        { error: "Database binding not found" },
        { status: 500 }
      );
    }

    const data = await request.json();

    const name = String(data.name || "").trim();
    const phone = String(data.phone || "").trim();
    const address = String(data.address || "").trim();

    if (!name || !phone || !address) {
      return Response.json(
       
