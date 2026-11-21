
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif"
]);

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
}

async function sha1Hex(value) {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(value)
  );

  return Array.from(
    new Uint8Array(digest),
    byte => byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function onRequestPost({ request, env }) {
  try {
    const cloudName = env.CLOUDINARY_CLOUD_NAME;
    const apiKey = env.CLOUDINARY_API_KEY;
    const apiSecret = env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      return json({ error: "Cloudinary settings are missing" }, 500);
    }

    const contentType = request.headers.get("Content-Type") || "";

    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      return json({ error: "يجب إرسال الصورة كملف" }, 415);
    }

    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return json({ error: "لم يتم اختيار صورة" }, 400);
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      return json({
        error: "نوع الصورة غير مدعوم. استخدم JPG أو PNG أو WEBP أو AVIF"
      }, 415);
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return json({
        error: "حجم الصورة يجب ألا يتجاوز 8 ميجابايت"
      }, 413);
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = "blackline-products";

    const signature = await sha1Hex(
      `folder=${folder}&timestamp=${timestamp}${apiSecret}`
    );

    const uploadForm = new FormData();

    uploadForm.append("file", file, file.name || "product-image");
    uploadForm.append("api_key", apiKey);
    uploadForm.append("timestamp", String(timestamp));
    uploadForm.append("folder", folder);
    uploadForm.append("signature", signature);

    const cloudinaryResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`,
      {
        method: "POST",
        body: uploadForm
      }
    );

    const result = await cloudinaryResponse.json().catch(() => null);

    if (!cloudinaryResponse.ok || !result?.secure_url) {
      return json({
        error: "فشل رفع الصورة إلى Cloudinary"
      }, 502);
    }

    return json({
      success: true,
      url: result.secure_url,
      public_id: result.public_id,
      width: result.width,
      height: result.height,
      format: result.format
    });

  } catch (error) {
    return json({
      error: "حدث خطأ أثناء رفع الصورة"
    }, 500);
  }
}
