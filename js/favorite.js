// お気に入り管理（localStorage）
function getFavs() {
  try { return JSON.parse(localStorage.getItem('favVoices') || '[]'); }
  catch { return []; }
}

function setFavs(favs) {
  localStorage.setItem('favVoices', JSON.stringify(favs));
}

function toggleFav(id) {
  const favs = getFavs();
  const idx = favs.indexOf(id);
  if (idx === -1) favs.push(id);
  else favs.splice(idx, 1);
  setFavs(favs);
  return idx === -1;
}

function isFav(id) {
  return getFavs().includes(id);
}
