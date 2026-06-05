export const getVideoSrc = (url?: string) => {
  if (!url) return "";
  
  // If it's a localhost URL
  if (url.includes("localhost:") && url.includes("/static/")) {
    const filename = url.split("/static/").pop();
    // Only convert to /static/ on production
    if (process.env.NODE_ENV === 'production' || (typeof window !== 'undefined' && window.location.hostname !== 'localhost')) {
      return `/static/${filename}`;
    }
    return url;
  }
  
  // If it's an R2 URL
  if (url.includes("pub-ec45a978b9c9499886c081c55519c8d9.r2.dev/scenes/")) {
    const filename = url.split("/scenes/").pop();
    return `/static/${filename}`;
  }
  
  return url;
};
