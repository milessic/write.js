from fastapi.templating import Jinja2Templates

mail_templates = Jinja2Templates(directory="templates/mailing")
def render_mail(template_name:str, context) -> str:
    t = mail_templates.get_template(template_name)
    return t.render(context)

