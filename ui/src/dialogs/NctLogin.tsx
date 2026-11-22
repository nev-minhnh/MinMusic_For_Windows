import { CredentialDialog, callSecret } from "../shell/account/kit";
import { refreshAccount } from "../shell/account/store";
import { t } from "../i18n";

/** MK 10: NhacCuaTui sign-in. Phone and country code are optional. The password is sent only here and cleared at once. */
export function NctLogin(props: { onClose: () => void; onDone?: () => void }) {
  return (
    <CredentialDialog
      testid="dlg-nct"
      title={t("w2_src_nct_title")}
      hint={t("w2_src_nct_hint")}
      submitLabel={t("w2_acct_login")}
      fields={[
        { key: "account", label: t("w2_src_nct_account"), autocomplete: "username" },
        { key: "password", label: t("w2_acct_password"), secret: true },
        { key: "phone", label: t("w2_src_nct_phone"), optional: true, check: (v) => (/^\d{6,15}$/.test(v) ? undefined : t("w2_src_err_phone")) },
        { key: "countryCode", label: t("w2_src_nct_cc"), optional: true, placeholder: "+84", check: (v) => (/^\+?\d{1,4}$/.test(v) ? undefined : t("w2_src_err_cc")) },
      ]}
      submit={async (v) => {
        const p: { account: string; password: string; phone?: string; countryCode?: string } = { account: v.account!, password: v.password! };
        if (v.phone) p.phone = v.phone;
        if (v.countryCode) p.countryCode = v.countryCode;
        await callSecret("source.nct.login", p);
        void refreshAccount();
      }}
      onClose={props.onClose}
      onDone={props.onDone}
    />
  );
}
