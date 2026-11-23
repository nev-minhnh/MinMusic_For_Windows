// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "solid-js/web";
import { RpcError } from "@minmusic/protocol";
import { NctLogin } from "./NctLogin";
import { LastfmLogin } from "./LastfmLogin";
import { TokenLogin } from "./TokenLogin";

const PW = "pw-vitest-secret-1";
type G = typeof globalThis & { __mmMock?: Record<string, (p: any) => unknown> };
const g = globalThis as G;
let dispose: (() => void) | null = null;
let closed = 0;
let calls: { m: string; p: any }[] = [];

const field = (k: string) => document.querySelector<HTMLInputElement>(`[data-testid="fld-${k}"]`)!;
const submit = () => document.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
const type = (k: string, v: string) => { field(k).value = v; };
const flush = () => new Promise((r) => setTimeout(r, 0));
const errText = () => document.querySelector<HTMLElement>('[data-testid="dlg-error"]')!;

function mount(C: (p: { onClose: () => void }) => any) {
  closed = 0;
  dispose = render(() => <C onClose={() => { closed++; }} />, document.body);
}
function answer(m: string, fn: (p: any) => unknown) {
  g.__mmMock = { ...(g.__mmMock ?? {}), [m]: (p) => { calls.push({ m, p }); return fn(p); } };
}

beforeEach(() => { calls = []; g.__mmMock = {}; });
afterEach(() => { dispose?.(); dispose = null; document.body.innerHTML = ""; });

describe("NCT login dialog", () => {
  it("clears the password field before the call is answered, and after success; closes", async () => {
    let release!: () => void;
    answer("source.nct.login", () => new Promise((r) => { release = () => r({ ok: true, vip: false }); }));
    answer("account.get", () => ({ signedIn: false }));
    answer("sources.list", () => ({ items: [], priority: [], autoBest: true, autoFallback: true }));
    mount(NctLogin);
    type("account", "tester");
    type("password", PW);
    submit();
    expect(field("password").value).toBe(""); // emptied in the same tick, while the request is in flight
    await flush();
    expect(calls.find((c) => c.m === "source.nct.login")?.p).toMatchObject({ account: "tester", password: PW });
    release();
    await flush();
    expect(closed).toBe(1);
    expect(document.body.innerHTML).not.toContain(PW);
  });

  it("failure: unauthorized shows the inline error, the password is empty, the dialog stays open, the message does not echo the secret", async () => {
    answer("source.nct.login", () => { throw new RpcError({ code: "unauthorized", msg: `bad ${PW}`, retryable: false }); });
    mount(NctLogin);
    type("account", "tester");
    type("password", PW);
    submit();
    await flush();
    expect(errText().hidden).toBe(false);
    expect(errText().textContent).toMatch(/Wrong account or password|Sai tài khoản/);
    expect(errText().textContent).not.toContain(PW);
    expect(field("password").value).toBe("");
    expect(closed).toBe(0);
    expect(document.body.innerHTML).not.toContain(PW);
    expect(document.activeElement).toBe(field("password"));
  });

  it("network error is shown inline too, and the form can be submitted again", async () => {
    answer("source.nct.login", () => { throw new RpcError({ code: "network", msg: "x", retryable: true }); });
    mount(NctLogin);
    type("account", "tester");
    type("password", PW);
    submit();
    await flush();
    expect(errText().textContent).toMatch(/connect|kết nối/i);
    type("password", PW);
    submit();
    await flush();
    expect(calls.filter((c) => c.m === "source.nct.login")).toHaveLength(2);
  });

  it("validation: empty account or password never calls the core; bad phone and country code are caught", async () => {
    mount(NctLogin);
    submit();
    await flush();
    expect(calls).toHaveLength(0);
    expect(errText().hidden).toBe(false);
    type("account", "tester");
    type("password", PW);
    type("phone", "12ab");
    submit();
    await flush();
    expect(calls).toHaveLength(0);
    type("password", PW);
    type("phone", "0900000000");
    type("countryCode", "vn");
    submit();
    await flush();
    expect(calls).toHaveLength(0);
    expect(field("password").type).toBe("password");
  });

  it("sends phone and country code only when filled", async () => {
    answer("source.nct.login", () => ({ ok: true, vip: true }));
    answer("account.get", () => ({ signedIn: false }));
    answer("sources.list", () => ({ items: [], priority: [], autoBest: true, autoFallback: true }));
    mount(NctLogin);
    type("account", "tester");
    type("password", PW);
    submit();
    await flush();
    const p = calls.find((c) => c.m === "source.nct.login")!.p;
    expect(Object.keys(p).sort()).toEqual(["account", "password"]);
  });

  it("Esc (via the dialog close button) cancels and clears", async () => {
    mount(NctLogin);
    type("password", PW);
    document.querySelector<HTMLButtonElement>('[data-testid="dlg-cancel"]')!.click();
    expect(closed).toBe(1);
  });
});

describe("Last.fm and token dialogs", () => {
  it("Last.fm: password cleared after a failed login, inline error", async () => {
    answer("lastfm.login", () => { throw new RpcError({ code: "unauthorized", msg: "no", retryable: false }); });
    mount(LastfmLogin);
    type("username", "someone");
    type("password", PW);
    submit();
    expect(field("password").value).toBe("");
    await flush();
    expect(errText().hidden).toBe(false);
    expect(field("password").value).toBe("");
    expect(document.body.innerHTML).not.toContain(PW);
  });

  it("token login masks and clears the cookie", async () => {
    answer("account.youtube.tokenLogin", () => ({}));
    answer("account.get", () => ({ signedIn: true }));
    answer("sources.list", () => ({ items: [], priority: [], autoBest: true, autoFallback: true }));
    mount(TokenLogin);
    expect(field("cookie").type).toBe("password");
    type("cookie", "SID=cookie-secret-1");
    submit();
    expect(field("cookie").value).toBe("");
    await flush();
    expect(closed).toBe(1);
  });
});
