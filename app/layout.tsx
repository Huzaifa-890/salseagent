import "./globals.css";
export const metadata = { title: "IT Reliable - Sales Agent" };

const THEME_INIT = `
(function () {
  try {
    var t = localStorage.getItem("theme");
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
  } catch (e) {}
})();
`;

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body>{children}</body>
    </html>
  );
}
