import { hasDeviceConnect, initDcLt } from "../../shell/DeviceConnectPanel/init";
import { mountDcHost } from "../../shell/DeviceConnectPanel/host";
import { toggleDc } from "../../shell/DeviceConnectPanel/store";
import type { Command } from "../ctx";

// Device Connect: D toggles the panel, `mm-open-dc` (player-bar device chip) opens it. Hidden when the core lacks the `deviceConnect` capability.
initDcLt();
mountDcHost();

export const commands: Command[] = [{ id: "pane.deviceConnect", run: () => void (hasDeviceConnect() && toggleDc()) }];
