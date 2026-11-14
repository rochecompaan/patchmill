import fsExt from "fs-ext";

export function flock(
  fd: number,
  mode: "ex" | "exnb" | "shnb" | "un",
): Promise<void> {
  return new Promise((resolve, reject) => {
    fsExt.flock(fd, mode, (error) => (error ? reject(error) : resolve()));
  });
}
