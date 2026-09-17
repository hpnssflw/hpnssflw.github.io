export default function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <p className="mono">
          <a href="mailto:hypnosisflow@gmail.com">hypnosisflow@gmail.com</a>
          {" · "}
          <a href="https://github.com/hpnssflw">github.com/hpnssflw</a>
          {" · "}
          {/* TODO: replace once the channel exists, see agent/deliver.py's TODO */}
          <a href="https://t.me/REPLACE_ME">Telegram</a>
          {" · © 2026"}
        </p>
      </div>
    </footer>
  );
}
