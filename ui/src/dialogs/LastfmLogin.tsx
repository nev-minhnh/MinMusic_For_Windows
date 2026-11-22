import { CredentialDialog, callSecret } from "../shell/account/kit";
import { t } from "../i18n";

/** Last.fm sign-in (same component as NCT). The core keeps only the session key, never the password. */
export function LastfmLogin(props: { onClose: () => void; onDone?: () => void }) {
  return (
    <CredentialDialog
      testid="dlg-lastfm"
      title={t("w2_int_lastfm_title")}
      hint={t("w2_int_lastfm_hint")}
      submitLabel={t("w2_acct_login")}
      fields={[
        { key: "username", label: t("w2_int_lastfm_user"), autocomplete: "username" },
        { key: "password", label: t("w2_acct_password"), secret: true },
      ]}
      submit={async (v) => {
        await callSecret("lastfm.login", { username: v.username!, password: v.password! });
      }}
      onClose={props.onClose}
      onDone={props.onDone}
    />
  );
}
