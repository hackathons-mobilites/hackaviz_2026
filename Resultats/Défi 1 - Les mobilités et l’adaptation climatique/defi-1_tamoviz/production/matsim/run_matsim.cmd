@echo off
rem Lance les cinq simulations MATSim (MATSim 15, Java 17) puis l'analyse.
rem Prérequis : matsim\lib\matsim-15.0\ (voir matsim\README.md). Durée : environ 30 min par scénario.
cd /d %~dp0scenario
set CP=..\lib\matsim-15.0\matsim-15.0.jar;..\lib\matsim-15.0\libs\*
for %%s in (ordinaire canicule clim freq horaires) do java -Xmx6g -cp "%CP%" org.matsim.run.RunMatsim config_%%s.xml
cd ..\..
python scripts\13_matsim_analysis.py
python scripts\14_matsim_anim.py ordinaire
python scripts\14_matsim_anim.py canicule
