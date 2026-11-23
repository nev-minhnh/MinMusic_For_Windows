import { CredentialDialog, callSecret } from "../shell/account/kit";
import { refreshAccount } from "../shell/account/store";
import { t } from "../i18n";

/** Advanced: sign in to YouTube Music with a pasted cookie (account.youtube.tokenLogin). The cookie is masked and cleared like a password. */
export function TokenLogin(props: { onClose: () => void; onDone?: () => void }) {
  return (
    <CredentialDialog
      testid="dlg-token"
      title={t("w2_src_token_title")}
      hint={t("w2_src_token_hint")}
      submitLabel={t("w2_acct_login")}
      fields={[
        { key: "cookie", label: t("w2_src_token_cookie"), secret: true },
        { key: "visitorData", label: t("w2_src_token_visitor"), optional: true },
        { key: "dataSyncId", label: t("w2_src_token_sync"), optional: true },
      ]}
      submit={async (v) => {
        const p: { cookie: string; visitorData?: string; dataSyncId?: string } = { cookie: v.cookie! };
        if (v.visitorData) p.visitorData = v.visitorData;
        if (v.dataSyncId) p.dataSyncId = v.dataSyncId;
        await callSecret("account.youtube.tokenLogin", p);
        void refreshAccount();
      }}
      onClose={props.onClose}
      onDone={props.onDone}
    />
  );
}
