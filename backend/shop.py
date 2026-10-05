from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys

_ROOT = Path(__file__).resolve().parents[1]
_spec = spec_from_file_location("backend.shop_root", _ROOT / "shop.py")
_module = module_from_spec(_spec)
sys.modules["backend.shop_root"] = _module
_spec.loader.exec_module(_module)

for _name in dir(_module):
    if not _name.startswith("_"):
        globals()[_name] = getattr(_module, _name)

__all__ = [name for name in dir(_module) if not name.startswith("_")]
