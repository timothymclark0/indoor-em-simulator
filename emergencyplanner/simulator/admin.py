from django.contrib import admin
from .models import *
# Register your models here.
appmodels = ([Building, Scenario, Detail, Level, Exit, Barrier, EvacGroup, 
           Scenario, SimulationGroup, EvacRoute, SimulationRoute,
           Network, NetworkNode,NetworkEdge])

for m in appmodels:
    admin.register(m)