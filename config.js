// SM home dekor – felhős mentés beállításai
// Supabase projekt: Project Settings → API (vagy Data API) oldalról másold be a két értéket.
// Ha üresen hagyod, az app "helyi módban" fut: minden adat csak az adott telefonon tárolódik.
// Az "anon / publishable" kulcs nyilvános lehet, az adatokat a sorszintű védelem (RLS) védi.
window.SMHD_CONFIG = {
  supabaseUrl: "",       // pl. "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: ""    // pl. "eyJhbGciOi..." vagy "sb_publishable_..."
};
