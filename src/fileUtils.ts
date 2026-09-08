import type { PortalFile } from "./types";

const photoExtension = /\.(avif|bmp|gif|heic|heif|jpe?g|png|webp)$/i;

/** Some phones and browsers omit an image MIME type. Preserve those uploads as photos. */
export const isPhotoUpload = (file: Pick<File, "name" | "type">) =>
  file.type.startsWith("image/") || photoExtension.test(file.name);

export const isPhotoFile = (file: Pick<PortalFile, "name" | "mimeType" | "category">) =>
  file.mimeType.startsWith("image/") || file.category === "Photos" || photoExtension.test(file.name);

