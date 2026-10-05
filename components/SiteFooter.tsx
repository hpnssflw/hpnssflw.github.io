/**
 * Site-wide footer, centred: the thesis, then the signature line — name,
 * year and the three ways to reach Artem.
 */
export default function SiteFooter() {
  return (
    <footer>
      <div className="wrap footer-inner">
        <p className="footer-thesis accent">
          Understand how it fails, then build so it doesn&apos;t.
        </p>
        <p className="footer-sign mono">
          © 2026 Artem Polozov
          {" · "}
          <a href="mailto:hypnosisflow@gmail.com">email</a>
          {" · "}
          <a href="https://github.com/hpnssflw">github</a>
          {" · "}
          <a href="https://t.me/hypnosisflow">telegram</a>
        </p>
      </div>
    </footer>
  );
}
