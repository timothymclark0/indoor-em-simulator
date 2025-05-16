from django.template.defaulttags import register

@register.simple_tag
def get_item(value, key):
    return value.get(key)