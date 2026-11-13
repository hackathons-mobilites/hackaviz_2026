"""Configurations MATSim 15 : journée ordinaire et canicule (vigilance rouge).
Sous-populations : cadre, essentiel (employés, ouvriers), autre. Stratégies : choix de plan (ChangeExpBeta), réitinéraire,
décalage horaire, changement de mode (TC, marche, vélo). Le télétravail est un plan concurrent : jambe « stay » avec une
constante négative (coût de ne pas aller sur le lieu de travail), plus faible pour les cadres.
Sortie : matsim/scenario/config_ordinaire.xml, config_canicule.xml"""
import sys
SC = "matsim/scenario/"
ITER = int(sys.argv[1]) if len(sys.argv) > 1 else 40
SUBPOPS = {'autre': -11.34, 'cadre': -7.94, 'essentiel': -14.74}     # calé sur le télétravail ordinaire (25 / 10 / 5 %)     # constante du télétravail (utils)
PT_MODES = ["rail", "subway", "tram", "bus_ac", "bus_noac", "cable"]

SCEN = {
  "ordinaire": dict(walk_speed=1.25, walk=-2.0, bike=-3.0, wait=-1.0, pt={"rail": -0.5, "subway": -0.5, "tram": -0.8, "bus_ac": -1.0, "bus_noac": -1.0, "cable": -0.8}),
  # canicule : attente et marche au soleil, marche plus lente ; le bus (arrêt en plein air) devient plus pénible que le métro,
  # surtout sans climatisation (recalé sur les indices observés : ferré 85, bus climatisés 68, non climatisés 58)
  "canicule":  dict(walk_speed=1.0, walk=-5.0, bike=-6.0, wait=-4.0, pt={"rail": -1.0, "subway": -2.0, "tram": -1.5, "bus_ac": -3.0, "bus_noac": -5.0, "cable": -1.5}),
  # mesures testées le même jour de canicule (entrées produites par 12c_matsim_levers.py)
  # clim : tout le parc bus climatisé (un bus non climatisé devient aussi supportable qu'un bus climatisé)
  "clim":      dict(walk_speed=1.0, walk=-5.0, bike=-6.0, wait=-4.0, pt={"rail": -1.0, "subway": -2.0, "tram": -1.5, "bus_ac": -3.0, "bus_noac": -3.0, "cable": -1.5}),
  # freq : départ de bus intermédiaire aux heures de pointe dès que l'intervalle atteint 10 minutes
  "freq":      dict(walk_speed=1.0, walk=-5.0, bike=-6.0, wait=-4.0, pt={"rail": -1.0, "subway": -2.0, "tram": -1.5, "bus_ac": -3.0, "bus_noac": -5.0, "cable": -1.5}, sched="transitSchedule_freq.xml.gz", veh="transitVehicles_freq.xml.gz"),
  # horaires : la moitié des cadres et des « autres » avancent leur journée d'une heure ; télétravail encouragé (+1)
  "horaires":  dict(walk_speed=1.0, walk=-5.0, bike=-6.0, wait=-4.0, pt={"rail": -1.0, "subway": -2.0, "tram": -1.5, "bus_ac": -3.0, "bus_noac": -5.0, "cable": -1.5}, pop="population_horaires.xml.gz", tele_bonus={"cadre": 1.0, "autre": 1.0}, work_open="06:00:00"),
}
def p(n, v): return f'<param name="{n}" value="{v}"/>'
def act(t, dur, op=None, cl=None, late=None):
    s = f'<parameterset type="activityParams">{p("activityType", t)}{p("typicalDuration", dur)}'
    if op: s += p("openingTime", op)
    if cl: s += p("closingTime", cl)
    if late: s += p("latestStartTime", late)
    return s + "</parameterset>"
def mode(m, mu, const=0.0):
    return f'<parameterset type="modeParams">{p("mode", m)}{p("marginalUtilityOfTraveling_util_hr", mu)}{p("constant", const)}</parameterset>'
def scoring(sub, cfg, stay_c):
    s = f'<parameterset type="scoringParameters">' + (p("subpopulation", sub) if sub else "")
    s += p("performing", 6.0) + p("lateArrival", -18.0) + p("waitingPt", cfg["wait"]) + p("utilityOfLineSwitch", -1.0)
    s += act("home", "12:00:00") + act("work", "08:30:00", cfg.get("work_open", "07:00:00"), "20:00:00", "10:30:00") + act("telework", "08:30:00")
    for m in ["walk", "transit_walk", "non_network_walk"]: s += mode(m, cfg["walk"])
    s += mode("bike", cfg["bike"], -1.0) + mode("pt", -1.0) + mode("stay", 0.0, stay_c) + mode("car", -1.0) + mode("ride", -1.0)
    for m, mu in cfg["pt"].items(): s += mode(m, mu)
    return s + "</parameterset>"
def strategies(sub):
    out = ""
    for name, w in [("ChangeExpBeta", 0.7), ("ReRoute", 0.1), ("TimeAllocationMutator", 0.1), ("SubtourModeChoice", 0.1)]:
        out += f'<parameterset type="strategysettings">{p("strategyName", name)}{p("weight", w)}{p("subpopulation", sub)}</parameterset>'
    return out
for name, cfg in SCEN.items():
    x = f"""<?xml version="1.0" ?>
<!DOCTYPE config SYSTEM "http://www.matsim.org/files/dtd/config_v2.dtd">
<config>
<module name="global">{p("coordinateSystem", "EPSG:2154")}{p("numberOfThreads", 4)}{p("randomSeed", 4711)}</module>
<module name="network">{p("inputNetworkFile", "network.xml.gz")}</module>
<module name="plans">{p("inputPlansFile", cfg.get("pop", "population.xml.gz"))}</module>
<module name="transit">{p("useTransit", "true")}{p("transitScheduleFile", cfg.get("sched", "transitSchedule.xml.gz"))}{p("vehiclesFile", cfg.get("veh", "transitVehicles.xml.gz"))}{p("transitModes", "pt," + ",".join(PT_MODES))}{p("routingAlgorithmType", "SwissRailRaptor")}</module>
<module name="swissRailRaptor">{p("useModeMappingForPassengers", "true")}{"".join(f'<parameterset type="modeMapping">{p("routeMode", m)}{p("passengerMode", m)}</parameterset>' for m in PT_MODES)}</module>
<module name="qsim">{p("startTime", "04:00:00")}{p("endTime", "30:00:00")}{p("flowCapacityFactor", 0.01)}{p("storageCapacityFactor", 0.01)}{p("numberOfThreads", 4)}{p("mainMode", "car")}</module>
<module name="controler">{p("outputDirectory", "../output_" + name)}{p("firstIteration", 0)}{p("lastIteration", ITER)}{p("overwriteFiles", "deleteDirectoryIfExists")}{p("writeEventsInterval", ITER)}{p("writePlansInterval", ITER)}{p("createGraphs", "true")}</module>
<module name="planscalcroute">{p("networkModes", "")}
 <parameterset type="teleportedModeParameters">{p("mode", "walk")}{p("teleportedModeSpeed", cfg["walk_speed"])}{p("beelineDistanceFactor", 1.3)}</parameterset>
 <parameterset type="teleportedModeParameters">{p("mode", "bike")}{p("teleportedModeSpeed", 4.2)}{p("beelineDistanceFactor", 1.3)}</parameterset>
 <parameterset type="teleportedModeParameters">{p("mode", "stay")}{p("teleportedModeSpeed", 1000.0)}{p("beelineDistanceFactor", 1.0)}</parameterset>
</module>
<module name="transitRouter">{p("maxBeelineWalkConnectionDistance", 400.0 if name == "ordinaire" else 250.0)}{p("searchRadius", 1000.0 if name == "ordinaire" else 600.0)}{p("extensionRadius", 200.0)}</module>
<module name="planCalcScore">{p("fractionOfIterationsToStartScoreMSA", 0.8)}{scoring("default", cfg, -6.0)}{"".join(scoring(s, cfg, c + cfg.get("tele_bonus", {}).get(s, 0.0)) for s, c in SUBPOPS.items())}</module>
<module name="strategy">{p("fractionOfIterationsToDisableInnovation", 0.8)}{p("maxAgentPlanMemorySize", 5)}{"".join(strategies(s) for s in SUBPOPS)}</module>
<module name="subtourModeChoice">{p("modes", "pt,walk,bike")}{p("chainBasedModes", "bike")}{p("considerCarAvailability", "false")}</module>
<module name="TimeAllocationMutator">{p("mutationRange", 3600.0)}</module>
<module name="vspExperimental">{p("vspDefaultsCheckingLevel", "ignore")}</module>
</config>
"""
    open(SC + f"config_{name}.xml", "w", encoding="utf-8").write(x)
    print("écrit", SC + f"config_{name}.xml")
RUN = '@echo off\r\nrem Lance les cinq simulations MATSim (MATSim 15, Java 17) puis l\'analyse.\r\nrem Prérequis : matsim\\lib\\matsim-15.0\\ (voir matsim\\README.md). Durée : environ 30 min par scénario.\r\ncd /d %~dp0scenario\r\nset CP=..\\lib\\matsim-15.0\\matsim-15.0.jar;..\\lib\\matsim-15.0\\libs\\*\r\nfor %%s in (@SCEN@) do java -Xmx6g -cp "%CP%" org.matsim.run.RunMatsim config_%%s.xml\r\ncd ..\\..\r\npython scripts\\13_matsim_analysis.py\r\npython scripts\\14_matsim_anim.py ordinaire\r\npython scripts\\14_matsim_anim.py canicule\r\n'
open("matsim/run_matsim.cmd", "w", encoding="utf-8", newline="").write(RUN.replace("@SCEN@", " ".join(SCEN)))
print("écrit matsim/run_matsim.cmd")
