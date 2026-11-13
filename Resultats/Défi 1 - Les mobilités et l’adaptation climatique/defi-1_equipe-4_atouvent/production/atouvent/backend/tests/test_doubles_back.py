"""Itinéraires en aller-retour sur une même ligne : écartés au profit d'un trajet direct."""
from app.router.engine import doubles_back


def leg(line, a, stops, b):
    p = lambda n: {"name": n}  # noqa: E731
    return {"mode": "RAIL", "line": line, "from": p(a), "stops": [p(s) for s in stops], "to": p(b)}


def walk():
    return {"mode": "WALK", "from": {"name": "x"}, "to": {"name": "y"}}


def test_aller_retour_detecte():
    # RER D vers le nord jusqu'à Châtelet, puis RER D vers le sud qui repasse par Gare de Lyon
    it = {"legs": [walk(), leg("D", "Gare de Lyon", [], "Châtelet - Les Halles"),
                   leg("D", "Châtelet - Les Halles", ["Gare de Lyon", "Maisons-Alfort - Alfortville"], "Corbeil-Essonnes"), walk()]}
    assert doubles_back(it)


def test_correspondance_normale_gardee():
    it = {"legs": [walk(), leg("A", "Nation", [], "Gare de Lyon"),
                   leg("D", "Gare de Lyon", ["Maisons-Alfort - Alfortville"], "Corbeil-Essonnes"), walk()]}
    assert not doubles_back(it)


def test_trajet_direct_garde():
    assert not doubles_back({"legs": [walk(), leg("D", "Gare de Lyon", ["Villeneuve-Saint-Georges"], "Corbeil-Essonnes")]})
