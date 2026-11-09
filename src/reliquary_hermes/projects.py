"""Hermes first-class project inventory for an already authenticated profile."""

from stat import S_ISREG

from .validation import ContractError, identifier, require, text


def active_projects(home):
    try:
        from hermes_cli import projects_db

        path = home / "projects.db"
        try:
            info = path.lstat()
        except FileNotFoundError:
            # Hermes has not created a registry for this profile yet.
            return {}
        require(S_ISREG(info.st_mode) and path.resolve(strict=True) == path, "invalid_project_registry")
        with projects_db.connect_closing(db_path=path) as connection:
            return {identifier(project.id): project for project in projects_db.list_projects(connection)}
    except Exception:
        raise ContractError("project_discovery_unavailable") from None


def routing_available():
    try:
        from agent import memory_provider
    except ImportError:
        return False
    version = getattr(memory_provider, "SESSION_PROJECT_ATTRIBUTION_VERSION", None)
    return type(version) is int and version == 1


def inventory(home):
    projects = active_projects(home)
    return {"projects": [{"id": key, "name": text(project.name)}
                         for key, project in projects.items()],
            "routing_available": routing_available()}
