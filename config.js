// SM home dekor – felhős mentés beállításai
// Supabase projekt: Project Settings → API (vagy Data API) oldalról másold be a két értéket.
// Ha üresen hagyod, az app "helyi módban" fut: minden adat csak az adott telefonon tárolódik.
// Az "anon / publishable" kulcs nyilvános lehet, az adatokat a sorszintű védelem (RLS) védi.
window.SMHD_CONFIG = {
  supabaseUrl: "https://dqtpydwvfgsclcscburp.supabase.co",       // pl. "https://abcdefghijkl.supabase.co"
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxdHB5ZHd2ZmdzY2xjc2NidXJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NTczODIsImV4cCI6MjEwNzAzMzM4Mn0.uJ6leH9vqtRHPKTOj4-G0q6NhJby1zJ4OrZciPaBpLs"    // pl. "eyJhbGciOi..." vagy "sb_publishable_..."
};
