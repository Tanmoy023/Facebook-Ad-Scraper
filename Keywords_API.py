from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Ad Keywords API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

AD_KEYWORDS = [
    "Zomato",
    "Swiggy",
    "Puma",
    "Amul",
    "Flipkart",
    "Nykaa",
    "Myntra",
    "Adidas",
    "Nike",
    "Dream11"
]


@app.get("/keyword/{index}")
def get_keyword(index: int):
    if index < 1 or index > len(AD_KEYWORDS):
        raise HTTPException(
            status_code=404,
            detail="Keyword not found"
        )

    return {
        "keyword": AD_KEYWORDS[index - 1]
    }


# uvicorn Keyword_API:app --reload