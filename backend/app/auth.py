import os

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import PyJWKClientConnectionError, PyJWKClientError


AWS_REGION = os.getenv("AWS_REGION", "eu-west-1")
USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID", "eu-west-1_iFcHB8J7W")
APP_CLIENT_ID = os.getenv("COGNITO_APP_CLIENT_ID", "1016qiheeqcsef2m4n9jek2c9s")
ISSUER = f"https://cognito-idp.{AWS_REGION}.amazonaws.com/{USER_POOL_ID}"
JWKS_CLIENT = PyJWKClient(
    f"{ISSUER}/.well-known/jwks.json",
    cache_jwk_set=True,
    lifespan=3600,
    timeout=3,
    cooldown_duration=5,
)
bearer_scheme = HTTPBearer(auto_error=False)


def require_cognito_access_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
):
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Inicia sesión para utilizar este servicio.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        signing_key = JWKS_CLIENT.get_signing_key_from_jwt(credentials.credentials)
        claims = jwt.decode(
            credentials.credentials,
            signing_key.key,
            algorithms=["RS256"],
            issuer=ISSUER,
            options={
                "verify_aud": False,
                "require": ["exp", "iat", "token_use", "client_id"],
            },
        )
        if claims.get("token_use") != "access" or claims.get("client_id") != APP_CLIENT_ID:
            raise jwt.InvalidTokenError("El token no corresponde a esta aplicación.")
        return claims
    except PyJWKClientConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No se pudo verificar la sesión con Cognito. Inténtalo de nuevo.",
        ) from exc
    except (PyJWKClientError, jwt.PyJWTError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La sesión no es válida o ha caducado. Vuelve a iniciar sesión.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
