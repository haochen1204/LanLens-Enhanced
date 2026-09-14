from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise RuntimeError(f"Could not patch {label}: expected source block not found")
    return text.replace(old, new, 1)


# Backend router registration.
main_path = Path("/app/backend/main.py")
main = main_path.read_text(encoding="utf-8")
main = replace_once(
    main,
    "from .routers import admin, auth, auto_scan_rules, client_errors, cmdb, connect, credentials, debug, deep_scan, devices, dhcp_monitor, dns_names, idoit, inventory, notifications, plugins, scan, scan_nodes, segments, services, snmp\n",
    "from .routers import admin, auth, auto_scan_rules, client_errors, cmdb, connect, credentials, debug, deep_scan, devices, dhcp_monitor, dns_names, idoit, inventory, notifications, plugins, scan, scan_nodes, segments, services, snmp, auto_services_api\n",
    "main router import",
)
main = replace_once(
    main,
    "app.include_router(services.global_router)\n",
    "app.include_router(services.global_router)\napp.include_router(auto_services_api.router)\n",
    "main router registration",
)
main_path.write_text(main, encoding="utf-8")


# Port-scan synchronization + device-detail service ordering.
devices_path = Path("/app/backend/routers/devices.py")
devices = devices_path.read_text(encoding="utf-8")
devices = replace_once(
    devices,
    "from ..services.port_scanner import normalize_port_spec, scan_ports_async, scan_single_port_async\n",
    "from ..services.port_scanner import normalize_port_spec, scan_ports_async, scan_single_port_async\nfrom ..services.auto_services_extension import sync_scan_result, service_sort_key\n",
    "devices extension import",
)
devices = replace_once(
    devices,
    "        _auto_check_https_certificate(db, device_id, result[\"open_ports\"])\n        db.commit()\n",
    "        _auto_check_https_certificate(db, device_id, result[\"open_ports\"])\n        sync_scan_result(db, device_id, result[\"open_ports\"], port_spec=port_spec)\n        db.commit()\n",
    "full port scan sync",
)
devices = replace_once(
    devices,
    "        _auto_check_https_certificate(db, device_id, result[\"open_ports\"])\n        db.commit()\n",
    "        _auto_check_https_certificate(db, device_id, result[\"open_ports\"])\n        sync_scan_result(db, device_id, result[\"open_ports\"], scanned_ports={port})\n        db.commit()\n",
    "single port scan sync",
)
# DeviceDetail gets services from DeviceResponse, not /devices/{id}/services. Sort here so
# React renders in the correct order from the start instead of relying on DOM shuffling.
devices = replace_once(
    devices,
    "        services=[ServiceResponse.model_validate(s) for s in device.services],\n",
    "        services=[ServiceResponse.model_validate(s) for s in sorted(device.services, key=service_sort_key)],\n",
    "device response service sorting",
)
devices_path.write_text(devices, encoding="utf-8")


# Service API ordering. This covers direct service refreshes and the global Services page.
services_path = Path("/app/backend/routers/services.py")
services = services_path.read_text(encoding="utf-8")
services = replace_once(
    services,
    "from ..services.settings_helpers import is_advanced_feature_enabled\n",
    "from ..services.settings_helpers import is_advanced_feature_enabled\nfrom ..services.auto_services_extension import service_sort_key, numeric_ip_sort_key, effective_service_port\n",
    "services extension import",
)
old_list = '''    return (\n        db.query(Service)\n        .filter(Service.device_id == device_id)\n        .order_by(Service.sort_order, Service.created_at)\n        .all()\n    )\n'''
new_list = '''    rows = (\n        db.query(Service)\n        .filter(Service.device_id == device_id)\n        .all()\n    )\n    return sorted(rows, key=service_sort_key)\n'''
services = replace_once(services, old_list, new_list, "per-device service API sorting")
needle = '''    rows = (\n        db.query(Service, Device)\n        .join(Device, Service.device_id == Device.id)\n        .order_by(Service.name, Device.label, Device.hostname, Device.ip_address)\n        .all()\n    )\n    return [\n'''
replacement = '''    rows = (\n        db.query(Service, Device)\n        .join(Device, Service.device_id == Device.id)\n        .all()\n    )\n    rows.sort(key=lambda pair: (\n        numeric_ip_sort_key(pair[1].ip_address),\n        effective_service_port(pair[0]) if effective_service_port(pair[0]) is not None else 65536,\n        0 if str(pair[0].protocol or "").lower() != "udp" else 1,\n        str(pair[0].name or "").lower(),\n        int(pair[0].id or 0),\n    ))\n    return [\n'''
services = replace_once(services, needle, replacement, "global service API sorting")
services_path.write_text(services, encoding="utf-8")


# UI enhancers handle status badges, endpoint labels, Chinese notifications and Network Changes localization.
index_path = Path("/app/frontend/dist/index.html")
index = index_path.read_text(encoding="utf-8")
for old in (
    '<script src="/lanlens-auto-services-ui.js"></script>',
    '<script src="/lanlens-auto-services-ui-v3.js"></script>',
    '<script src="/lanlens-auto-services-ui-v4.js"></script>',
):
    index = index.replace(old, '')
for tag in (
    '<script src="/lanlens-auto-services-ui-v5.js"></script>',
    '<script src="/lanlens-changes-zh-v6.js"></script>',
):
    if tag not in index:
        if "</body>" not in index:
            raise RuntimeError("Could not patch frontend index.html: </body> missing")
        index = index.replace("</body>", f"  {tag}\n</body>", 1)
index_path.write_text(index, encoding="utf-8")

print("LanLens Enhanced v6 runtime patch applied")
