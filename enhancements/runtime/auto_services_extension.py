"""LanLens v1.5.9 extension helpers for automatic Service discovery and port state tracking.

This module adds one extension-owned table and never changes LanLens' existing tables.
User-edited Service fields are never overwritten after the Service has been created/mapped.
"""
from __future__ import annotations

import ipaddress
import logging
from datetime import datetime
from typing import Any, Iterable
from urllib.parse import urlsplit

from sqlalchemy import Boolean, Column, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Session

from backend.database import Base, engine
from backend.models import Device, Notification, Service

logger = logging.getLogger("lanlens.auto_services")


class AutoServiceStatus(Base):
    __tablename__ = "lanlens_auto_service_status"
    __table_args__ = (
        UniqueConstraint("device_id", "transport", "port", name="uq_lanlens_auto_service_status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(Integer, nullable=False, index=True)
    service_id = Column(Integer, nullable=True, index=True)
    transport = Column(String(8), nullable=False, default="tcp")
    port = Column(Integer, nullable=False)
    online = Column(Boolean, nullable=False, default=False)
    detected_service = Column(String(128), nullable=True)
    first_seen_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_checked_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    last_open_at = Column(DateTime, nullable=True)


# Safe, extension-owned schema. checkfirst keeps upgrades/restarts idempotent.
try:
    AutoServiceStatus.__table__.create(bind=engine, checkfirst=True)
except Exception:
    logger.exception("Could not create lanlens_auto_service_status table")


_FRIENDLY_NAMES = {
    "ssh": "SSH",
    "http": "HTTP",
    "http-alt": "HTTP",
    "http-proxy": "HTTP Proxy",
    "https": "HTTPS",
    "https-alt": "HTTPS",
    "ssl/http": "HTTPS",
    "domain": "DNS",
    "dns": "DNS",
    "ms-wbt-server": "RDP",
    "rdp": "RDP",
    "microsoft-ds": "SMB",
    "netbios-ssn": "SMB",
    "ftp": "FTP",
    "ftp-data": "FTP",
    "telnet": "Telnet",
    "smtp": "SMTP",
    "imap": "IMAP",
    "pop3": "POP3",
    "mysql": "MySQL",
    "postgresql": "PostgreSQL",
    "postgres": "PostgreSQL",
    "redis": "Redis",
    "mongodb": "MongoDB",
    "vnc": "VNC",
    "rfb": "VNC",
    "snmp": "SNMP",
    "ntp": "NTP",
    "epmd": "EPMD",
    "ws-discovery": "WS-Discovery",
    "ws-discoveryother": "WS-Discovery",
    "winbox": "WinBox",
}

_HTTPS_PORTS = {443, 8443, 9443, 9444, 10443}
_HTTP_PORTS = {80, 3000, 5000, 5666, 8000, 8008, 8080, 8081, 8086, 8087, 8088, 8089, 8090, 8096, 8888}


def _normalize_transport(value: Any) -> str:
    value = str(value or "tcp").strip().lower()
    return value if value in {"tcp", "udp"} else "tcp"


def _normalize_service_name(raw: Any, port: int) -> str:
    value = str(raw or "").strip().lower()
    if not value or value in {"unknown", "tcpwrapped", "unknown-service"}:
        fallback = {
            22: "SSH",
            53: "DNS",
            80: "HTTP",
            443: "HTTPS",
            445: "SMB",
            3389: "RDP",
            4369: "EPMD",
            5900: "VNC",
            8291: "WinBox",
        }.get(port)
        return fallback or "未知服务"
    return _FRIENDLY_NAMES.get(value, value.upper() if len(value) <= 12 else value)


def _classify(raw: Any, port: int, transport: str) -> tuple[str, str, str | None]:
    value = str(raw or "").strip().lower()
    if port in _HTTPS_PORTS or "https" in value or "ssl" in value:
        return "web", "https", "https"
    if port in _HTTP_PORTS or value.startswith("http"):
        return "web", "http", "http"
    if value == "ssh" or port == 22:
        return "ssh", "ssh", None
    if value in {"ms-wbt-server", "rdp"} or port == 3389:
        return "rdp", transport, None
    if value in {"mysql", "postgresql", "postgres", "redis", "mongodb"}:
        return "database", transport, None
    if value in {"nfs", "smb", "microsoft-ds", "netbios-ssn"}:
        return "storage", transport, None
    return "other", transport, None


def _make_url(ip: str | None, port: int, scheme: str | None) -> str | None:
    if not ip or not scheme:
        return None
    if (scheme == "http" and port == 80) or (scheme == "https" and port == 443):
        return f"{scheme}://{ip}"
    return f"{scheme}://{ip}:{port}"


def _service_transport(service: Service) -> str:
    protocol = str(service.protocol or "").strip().lower()
    return "udp" if protocol == "udp" else "tcp"


def effective_service_port(service: Service) -> int | None:
    """Return the endpoint port, inferring it from a URL when Service.port is empty."""
    try:
        if service.port is not None:
            port = int(service.port)
            if 1 <= port <= 65535:
                return port
    except (TypeError, ValueError):
        pass

    raw_url = str(service.url or "").strip()
    if raw_url:
        try:
            parsed = urlsplit(raw_url)
            if parsed.port:
                return int(parsed.port)
            scheme = (parsed.scheme or "").lower()
            if scheme == "http":
                return 80
            if scheme == "https":
                return 443
        except Exception:
            pass
    return None


def service_sort_key(service: Service):
    """Stable device-page order: numeric port, TCP before UDP, then name/id."""
    port = effective_service_port(service)
    transport = _service_transport(service)
    return (port if port is not None else 65536, 0 if transport == "tcp" else 1, str(service.name or "").lower(), int(service.id or 0))


def _entry_map(open_ports: Iterable[dict[str, Any]]) -> dict[tuple[str, int], dict[str, Any]]:
    result: dict[tuple[str, int], dict[str, Any]] = {}
    for entry in open_ports or []:
        if str(entry.get("state") or "open").lower() != "open":
            continue
        try:
            port = int(entry.get("port"))
        except (TypeError, ValueError):
            continue
        if not 1 <= port <= 65535:
            continue
        transport = _normalize_transport(entry.get("protocol"))
        result[(transport, port)] = entry
    return result


def _explicit_scope_matcher(port_spec: str | None):
    """Return a function(port)->bool for explicit specs, or None for top:N/unknown specs."""
    spec = (port_spec or "").strip().lower()
    if not spec or spec.startswith("top:"):
        return None
    ranges: list[tuple[int, int]] = []
    try:
        for token in (part.strip() for part in spec.split(",")):
            if not token:
                continue
            if "-" in token:
                start_s, end_s = token.split("-", 1)
                start, end = int(start_s), int(end_s)
            else:
                start = end = int(token)
            if start < 1 or end > 65535 or start > end:
                return None
            ranges.append((start, end))
    except Exception:
        return None
    if not ranges:
        return None
    return lambda port: any(start <= port <= end for start, end in ranges)


def _get_or_create_status(db: Session, device_id: int, transport: str, port: int) -> AutoServiceStatus:
    row = (
        db.query(AutoServiceStatus)
        .filter(
            AutoServiceStatus.device_id == device_id,
            AutoServiceStatus.transport == transport,
            AutoServiceStatus.port == port,
        )
        .first()
    )
    if row is None:
        row = AutoServiceStatus(device_id=device_id, transport=transport, port=port)
        db.add(row)
        db.flush()
    return row


def _resolve_or_create_service(
    db: Session,
    device: Device,
    status: AutoServiceStatus,
    entry: dict[str, Any],
) -> Service:
    # Reuse a previously mapped service if it still exists.
    if status.service_id:
        existing = db.query(Service).filter(Service.id == status.service_id).first()
        if existing is not None:
            return existing
        status.service_id = None

    # Reuse an existing manually configured service on the same endpoint where possible.
    candidates = (
        db.query(Service)
        .filter(Service.device_id == device.id, Service.port == status.port)
        .order_by(Service.id.asc())
        .all()
    )
    mapped_ids = {
        service_id
        for (service_id,) in db.query(AutoServiceStatus.service_id)
        .filter(AutoServiceStatus.device_id == device.id, AutoServiceStatus.service_id.isnot(None))
        .all()
        if service_id is not None
    }
    for candidate in candidates:
        if candidate.id in mapped_ids:
            continue
        if _service_transport(candidate) == status.transport or status.transport == "tcp":
            status.service_id = candidate.id
            return candidate

    detected = entry.get("service")
    name = _normalize_service_name(detected, status.port)
    service_type, protocol, scheme = _classify(detected, status.port, status.transport)
    service = Service(
        device_id=device.id,
        name=name,
        service_type=service_type,
        protocol=protocol,
        port=status.port,
        url=_make_url(device.ip_address, status.port, scheme),
        service_group_id=None,
        description="自动发现的开放端口，可直接编辑名称、说明和分组。",
        sort_order=status.port,
    )
    db.add(service)
    db.flush()
    status.service_id = service.id
    return service


def _port_notification(
    db: Session,
    device: Device,
    subtype: str,
    transport: str,
    port: int,
    service: Service | None,
) -> None:
    """Create a transition notification for a newly discovered or offline port."""
    if getattr(device, "ignored", False) or getattr(device, "notifications_muted", False):
        return
    ip = device.ip_address or "未知IP"
    name = str(getattr(service, "name", "") or "").strip()
    suffix = f"（{name}）" if name else ""
    endpoint = f"{ip}:{port}/{transport.upper()}"
    if subtype == "port_opened":
        message = f"New port discovered: {endpoint}{suffix}"
    elif subtype == "port_offline":
        message = f"Port offline: {endpoint}{suffix}"
    else:
        return
    db.add(Notification(
        device_id=device.id,
        event_type="network_change",
        event_subtype=subtype,
        message=message,
    ))


def _mapped_service(db: Session, status: AutoServiceStatus) -> Service | None:
    if not status.service_id:
        return None
    return db.query(Service).filter(Service.id == status.service_id).first()


def sync_scan_result(
    db: Session,
    device_id: int,
    open_ports: Iterable[dict[str, Any]],
    *,
    port_spec: str | None = None,
    scanned_ports: set[int] | None = None,
) -> None:
    """Create/map Services and update online/offline state for a completed scan.

    - For a single-port scan, pass scanned_ports={port}; only that endpoint changes state.
    - For an explicit range/list spec, all Service ports in that scope are updated.
    - For top:N, only already-tracked endpoints plus newly-open endpoints are updated. This
      avoids declaring unrelated, never-scanned manual high ports offline.
    """
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        return

    now = datetime.utcnow()
    open_map = _entry_map(open_ports)
    explicit_match = _explicit_scope_matcher(port_spec)

    # First, make sure every open endpoint has a status row and mapped Service.
    # A notification is created only when this endpoint has never been tracked before.
    for (transport, port), entry in open_map.items():
        existing_status = (
            db.query(AutoServiceStatus)
            .filter(
                AutoServiceStatus.device_id == device_id,
                AutoServiceStatus.transport == transport,
                AutoServiceStatus.port == port,
            )
            .first()
        )
        is_new_endpoint = existing_status is None
        status = existing_status or _get_or_create_status(db, device_id, transport, port)
        service = _resolve_or_create_service(db, device, status, entry)
        status.online = True
        status.detected_service = str(entry.get("service") or "unknown")[:128]
        status.last_checked_at = now
        status.last_open_at = now
        if is_new_endpoint:
            _port_notification(db, device, "port_opened", transport, port, service)

    # Work out which known endpoints were definitely covered by this scan.
    tracked = db.query(AutoServiceStatus).filter(AutoServiceStatus.device_id == device_id).all()
    covered: set[tuple[str, int]] = set()
    if scanned_ports is not None:
        # LanLens v1.5.9 uses TCP SYN/connect scans. Only TCP endpoints are conclusively
        # covered by an exact single-port scan; never mark UDP offline from a TCP scan.
        covered = {(row.transport, row.port) for row in tracked if row.transport == "tcp" and row.port in scanned_ports}
        # Include manual Services in an exact single-port scan even if never observed open.
        for service in db.query(Service).filter(Service.device_id == device_id).all():
            service_port = effective_service_port(service)
            if service_port in scanned_ports and _service_transport(service) == "tcp":
                row = _get_or_create_status(db, device_id, "tcp", int(service_port))
                if not row.service_id:
                    row.service_id = service.id
                covered.add(("tcp", int(service_port)))
    elif explicit_match is not None:
        # Explicit list/range scans are conclusive for TCP ports inside that scope.
        covered = {(row.transport, row.port) for row in tracked if row.transport == "tcp" and explicit_match(row.port)}
        for service in db.query(Service).filter(Service.device_id == device_id).all():
            port = effective_service_port(service)
            if port is not None and explicit_match(port) and _service_transport(service) == "tcp":
                row = _get_or_create_status(db, device_id, "tcp", port)
                if not row.service_id:
                    row.service_id = service.id
                covered.add(("tcp", port))
    else:
        # top:N is not a conclusive scope for arbitrary custom ports. We only promote
        # ports found open; we do NOT mark previously known endpoints offline here.
        # This avoids false red/offline badges for ports that were not part of top:N.
        covered = set()

    covered.update(open_map.keys())
    for transport, port in covered:
        row = _get_or_create_status(db, device_id, transport, port)
        entry = open_map.get((transport, port))
        was_online = bool(row.online)
        is_online = entry is not None
        row.online = is_online
        row.last_checked_at = now
        if entry is not None:
            row.last_open_at = now
            row.detected_service = str(entry.get("service") or "unknown")[:128]
        elif was_online:
            _port_notification(db, device, "port_offline", transport, port, _mapped_service(db, row))

    logger.info(
        "Synced auto Services/status for device %s: %s open, %s covered",
        device_id,
        len(open_map),
        len(covered),
    )


def status_payload(db: Session) -> list[dict[str, Any]]:
    rows = db.query(AutoServiceStatus).all()
    service_ids = {row.service_id for row in rows if row.service_id}
    services = {
        service.id: service
        for service in db.query(Service).filter(Service.id.in_(service_ids)).all()
    } if service_ids else {}
    device_ids = {row.device_id for row in rows}
    devices = {
        device.id: device
        for device in db.query(Device).filter(Device.id.in_(device_ids)).all()
    } if device_ids else {}

    payload: list[dict[str, Any]] = []
    for row in rows:
        service = services.get(row.service_id) if row.service_id else None
        device = devices.get(row.device_id)
        if row.service_id and service is None:
            continue
        payload.append({
            "service_id": row.service_id,
            "device_id": row.device_id,
            "device_ip": device.ip_address if device else None,
            "transport": row.transport,
            "port": row.port,
            "online": bool(row.online),
            "detected_service": row.detected_service,
            "last_checked_at": row.last_checked_at.isoformat() + "Z" if row.last_checked_at else None,
            "last_open_at": row.last_open_at.isoformat() + "Z" if row.last_open_at else None,
        })
    return payload


def numeric_ip_sort_key(ip: str | None):
    try:
        parsed = ipaddress.ip_address(ip or "")
        return (parsed.version, int(parsed))
    except Exception:
        return (99, 2**130)
