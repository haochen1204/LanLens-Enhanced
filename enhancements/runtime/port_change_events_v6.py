"""LanLens Enhanced v6: mirror port transitions into the stock Changes timeline.

The existing auto-services extension already decides when a port is genuinely new or
conclusively offline.  This module wraps that transition hook so the same transition is
also written to DeviceChangeEvent without changing the existing database schema.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from backend.models import Device, DeviceChangeEvent, Service
from backend.services import auto_services_extension as extension


def _install() -> None:
    if getattr(extension, "_port_change_events_v6_installed", False):
        return

    original = extension._port_notification

    def _port_notification_with_change(
        db: Session,
        device: Device,
        subtype: str,
        transport: str,
        port: int,
        service: Service | None,
    ) -> None:
        # Preserve the existing in-app notification behavior first.
        original(db, device, subtype, transport, port, service)

        if subtype not in {"port_opened", "port_offline"}:
            return

        ip = device.ip_address or "未知IP"
        name = str(getattr(service, "name", "") or "").strip()
        suffix = f"（{name}）" if name else ""
        endpoint = f"{ip}:{int(port)}/{str(transport or 'tcp').upper()}"
        field_name = f"{endpoint}{suffix}"

        if subtype == "port_opened":
            old_value = "untracked"
            new_value = "online"
            message = f"New port discovered: {endpoint}{suffix}"
        else:
            old_value = "online"
            new_value = "offline"
            message = f"Port offline: {endpoint}{suffix}"

        db.add(DeviceChangeEvent(
            device_id=device.id,
            event_type=subtype,
            field_name=field_name,
            old_value=old_value,
            new_value=new_value,
            source="port_scan",
            message=message,
        ))

    extension._port_notification = _port_notification_with_change
    extension._port_change_events_v6_installed = True


_install()
