from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.auth.dependencies import get_current_user
from backend.database import get_db
from backend.models import User
from backend.services.auto_services_extension import status_payload

router = APIRouter(prefix="/api/services", tags=["services"])


@router.get("/auto-status")
def auto_service_statuses(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return status_payload(db)
