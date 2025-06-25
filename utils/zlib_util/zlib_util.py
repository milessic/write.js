import zlib
from fastapi import HTTPException
import base64


def compress(input_str: str) -> str:
    try:
        compressed = zlib.compress(input_str.encode())  # Compress to bytes
        b64 = base64.b64encode(compressed).decode()  # Encode to Base64
        return b64.replace("/", "_").replace("+", "-")
    except Exception as e:
        raise HTTPException(500, f"zlib error: {e}")


def decompress(compressed: str) -> str:
    try:
        b64 = compressed.replace("-", "+").replace("_", "/")
        binary_data = base64.b64decode(b64)  # Decode Base64
        decompressed = zlib.decompress(binary_data).decode()  # Decompress to string
        return decompressed
    except Exception as e:
        raise HTTPException(500, f"zlib error: {e}")
