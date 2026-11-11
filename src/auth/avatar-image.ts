export async function prepareAvatar(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("请选择 JPG、PNG 或 WebP 图片。");
  if (file.size > 5 * 1024 * 1024) throw new Error("头像原图不能超过 5 MB。");
  const source = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = source;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 64000000
    )
      throw new Error("图片尺寸过大或无法读取。");
    const square = Math.min(image.naturalWidth, image.naturalHeight),
      size = Math.min(512, square);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器暂不支持头像处理。");
    ctx.drawImage(
      image,
      (image.naturalWidth - square) / 2,
      (image.naturalHeight - square) / 2,
      square,
      square,
      0,
      0,
      size,
      size,
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (v) =>
          v && v.type === "image/webp"
            ? resolve(v)
            : reject(
                new Error("浏览器暂不支持 WebP 头像，请使用较新的浏览器。"),
              ),
        "image/webp",
        0.85,
      ),
    );
    if (blob.size > 5 * 1024 * 1024) throw new Error("压缩后的头像过大。");
    return blob;
  } catch (error) {
    throw error instanceof Error ? error : new Error("图片无法读取。");
  } finally {
    URL.revokeObjectURL(source);
  }
}
