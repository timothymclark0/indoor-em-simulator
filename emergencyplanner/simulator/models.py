from django.contrib.gis.db import models
from django.contrib.gis.geos import GEOSGeometry, LineString, Polygon, MultiPolygon
from functools import reduce
from django.utils import timezone
# Create your models here.

class Building(models.Model):
    name = models.CharField(max_length=100)
    st_address_1 = models.CharField(max_length=100,null=True, blank=True)
    st_address_2 = models.CharField(max_length=100,null=True, blank=True)
    city = models.CharField(max_length=100,null=True, blank=True)
    state = models.CharField(max_length=2,null=True, blank=True)
    zip_code = models.CharField(max_length=5,null=True, blank=True)
    footprint = models.MultiPolygonField(null=True, srid=3857, blank=True)
    
    def footprint_calc(self):
        lvls = Level.objects.filter(building = self)
        if len(lvls) > 1:
            shape = reduce(lambda a, b: a.geom | b.geom, lvls)
        elif len(lvls) == 1:
            shape = lvls[0].geom
        else:
            shape = None
        if type(shape) == Polygon:
            shape = MultiPolygon(shape)
        return shape

class Level(models.Model):
    esri_id = models.CharField(max_length=100,null=True)
    building = models.ForeignKey(Building, on_delete = models.CASCADE)
    long_name = models.CharField(max_length=100,null=True)
    short_name = models.CharField(max_length=100,null=True)
    order = models.IntegerField()
    geom = models.PolygonField(srid=3857)
        
class Detail(models.Model):
    esri_id = models.CharField(max_length=100,null=True)
    use_type = models.CharField(max_length=100,null=True)
    level = models.ForeignKey(Level, on_delete = models.CASCADE)
    geom = models.MultiLineStringField(srid=3857)
    
class Scenario(models.Model):
    name = models.CharField(max_length=100,null=True,blank=True)
    building = models.ForeignKey(Building, on_delete = models.CASCADE)
    notes = models.CharField(max_length=5000,null=True, blank=True)
    start_t = models.DateTimeField(default=timezone.now)
    simulation_status = models.CharField(max_length=10, default='None',blank=True)
    edit_lock = models.BooleanField(default=False, blank=True)
    
class Tag(models.Model):
    tag = models.CharField(max_length=40, blank=True)
    
    def __str__(self):
        return self.tag 

class ScenarioTags(models.Model):
    tag = models.ForeignKey(Tag, on_delete= models.CASCADE)
    scenario = models.ForeignKey(Scenario, on_delete = models.CASCADE)
  
class Network(models.Model):
    name = models.CharField(max_length=40, null=True)
    method = models.CharField(max_length=40, null=True)
    scenario = models.ForeignKey(Scenario, on_delete = models.CASCADE)
    
class NetworkNode(models.Model):
    network = models.ForeignKey(Network, on_delete = models.CASCADE)
    x = models.IntegerField()
    y = models.IntegerField()
    geom = models.PointField(srid=3857)
    
class NetworkEdge(models.Model):
    length = models.FloatField(default=0)
    cost = models.FloatField(default= 0)
    wall_distance = models.FloatField(default=0)
    from_node = models.ForeignKey(NetworkNode, on_delete = models.CASCADE, related_name='from_node')
    to_node = models.ForeignKey(NetworkNode, on_delete = models.CASCADE, related_name= 'to_node')
    geom = models.LineStringField(default=LineString([]),srid = 3857)
    
    def get_line(self):
        return LineString([self.from_node.geom, self.to_node.geom], srid =3857)
    
class EvacRoute(models.Model):
    network = models.ForeignKey(Network, on_delete = models.CASCADE)
    geom = models.LineStringField(default = LineString([]))
    valid = models.BooleanField(default=True)
        
class EvacGroup(models.Model):
    scenario = models.ForeignKey(Scenario, on_delete = models.CASCADE)
    capacity = models.IntegerField(default = 1)
    evac_time = models.DateTimeField(null=True)
    geom = models.PointField()
    
class Exit(models.Model):
    scenario = models.ForeignKey(Scenario, on_delete = models.CASCADE)
    geom = models.PointField()
    
class Barrier(models.Model):
    scenario = models.ForeignKey(Scenario, on_delete = models.CASCADE)
    geom = models.LineStringField()
    
class SimulationRoute(models.Model):
    scenario = models.ForeignKey(Scenario, on_delete = models.CASCADE)
    min_width = models.FloatField(default = 20)
    peak_capacity = models.IntegerField(default = 0)
    routing_id = models.CharField(max_length=255, null=True)
    first_t = models.DateTimeField()
    last_t = models.DateTimeField()
    
class SimulationGroup(models.Model):
    scenario = models.ForeignKey(Scenario, on_delete = models.CASCADE)
    capacity = models.IntegerField(default = 1)
    velocity = models.FloatField(default = 0)
    t = models.DateTimeField()
    current_segment = models.CharField(max_length=255, null = True)
    status = models.CharField(max_length=10)
    geom = models.PointField()
    