from django import forms
from django.forms import modelformset_factory
from .models import *

state_codes = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', '']

class BuildingForm(forms.ModelForm):
    #custom_footprint = forms.BooleanField(widget=forms.CheckboxInput())
    class Meta:
        model = Building
        fields = ['name','st_address_1','st_address_2',
                  'city','state','zip_code']
        widgets = {'state':forms.Select(choices = [(x,x) for x in state_codes]),
                   'footprint':forms.ClearableFileInput()}
        
class UploadGeoJson(forms.Form):
    layer = forms.ChoiceField(choices = [('level','Levels'),('detail','Details')])
    title = forms.CharField(max_length=50,required=False)
    upload = forms.FileField()
    widgets = {'upload': forms.FileInput()}
    
class ScenarioForm(forms.ModelForm):
    class Meta:
        model = Scenario
        fields = ['name', 'notes', 'start_t']
        widgets = {'notes': forms.Textarea, 'start_t': forms.DateTimeInput}

class ScenarioTagForm(forms.ModelForm):
    class Meta:
        model = ScenarioTags
        fields = ['tag']

class CreateTag(forms.ModelForm):
    class Meta:
        Model = Tag
        fields = ['tag']
        
ScenarioTagFormSet = modelformset_factory(model = ScenarioTags, extra = 1, fields = ['tag'])
TagFormSet = modelformset_factory(model = Tag, extra = 1, fields = ['tag'])
